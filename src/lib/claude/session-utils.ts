import { ACTIVE_MS, IDLE_MS } from "./constants";
import type { ClaudeSessionEntry } from "./types";

/**
 * Determine session status based on file modification time.
 * Returns null for sessions older than completedMs (default 1 hour).
 */
export function getSessionStatus(
  mtimeMs: number,
  completedMs: number | null = 60 * 60 * 1000
): "active" | "idle" | "completed" | null {
  const age = Date.now() - mtimeMs;
  if (age < ACTIVE_MS) return "active";
  if (age < IDLE_MS) return "idle";
  if (completedMs === null || age < completedMs) return "completed";
  return null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Aggregate token usage from JSONL entries that have message.usage fields */
export function aggregateTokensFromEntries(entries: ClaudeSessionEntry[]): TokenUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (const e of entries) {
    if (e.message?.usage) {
      const u = e.message.usage;
      inputTokens += u.input_tokens || 0;
      outputTokens += u.output_tokens || 0;
      cacheReadTokens += u.cache_read_input_tokens || 0;
      cacheCreationTokens += u.cache_creation_input_tokens || 0;
    }
  }

  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
}

/** Extract per-message token usage for timeline entries */
export function extractMessageUsage(
  entry: ClaudeSessionEntry
): TokenUsage | undefined {
  if (!entry.message?.usage) return undefined;
  const u = entry.message.usage;
  return {
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    cacheReadTokens: u.cache_read_input_tokens || 0,
    cacheCreationTokens: u.cache_creation_input_tokens || 0,
  };
}
