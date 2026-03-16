/**
 * In-memory pub/sub for agent run events.
 * Allows SSE endpoints to stream live activity from running agents.
 */

export type RunEventType =
  | "started"
  | "tool_start"
  | "tool_result"
  | "text"
  | "complete";

export interface RunEvent {
  type: RunEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

type Listener = (event: RunEvent) => void;

interface RunState {
  events: RunEvent[];
  listeners: Set<Listener>;
  generation: number;
}

const MAX_EVENTS = 500;

// Map<agentId, RunState>
const activeRuns = new Map<string, RunState>();
let nextGeneration = 0;

/** Start tracking events for an agent run */
export function startRun(agentId: string): void {
  activeRuns.set(agentId, {
    events: [],
    listeners: new Set(),
    generation: ++nextGeneration,
  });
}

/** Emit an event for a running agent */
export function emitRunEvent(agentId: string, event: RunEvent): void {
  const state = activeRuns.get(agentId);
  if (!state) return;
  if (state.events.length < MAX_EVENTS) {
    state.events.push(event);
  }
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch {
      // listener error, ignore
    }
  }
}

/** Clean up after a run completes */
export function endRun(agentId: string): void {
  const state = activeRuns.get(agentId);
  if (!state) return;
  const gen = state.generation;
  // Give listeners a moment to receive the complete event, then clean up.
  // Only delete if the generation matches (prevents deleting a new run's state).
  setTimeout(() => {
    const current = activeRuns.get(agentId);
    if (current && current.generation === gen) {
      activeRuns.delete(agentId);
    }
  }, 5000);
}

/**
 * Subscribe to events for a running agent.
 * Immediately replays all events emitted so far, then streams new ones.
 * Returns an unsubscribe function.
 */
export function subscribeToRun(
  agentId: string,
  listener: Listener
): (() => void) | null {
  const state = activeRuns.get(agentId);
  if (!state) return null;

  // Replay existing events
  let hasComplete = false;
  for (const event of state.events) {
    try {
      listener(event);
      if (event.type === "complete") hasComplete = true;
    } catch {
      // ignore
    }
  }

  // If replay included a complete event, don't subscribe for more
  if (hasComplete) {
    return () => {};
  }

  // Subscribe to new events
  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
}

/** Check if a run is being tracked */
export function isRunActive(agentId: string): boolean {
  return activeRuns.has(agentId);
}
