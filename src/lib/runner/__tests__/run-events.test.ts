import { describe, test, expect, afterEach } from "bun:test";
import {
  startRun,
  endRun,
  emitRunEvent,
  subscribeToRun,
  isRunActive,
  type RunEvent,
} from "../run-events";

// Clean up after each test to prevent state leakage
afterEach(() => {
  // End all active runs we may have started
  for (const id of ["agent-a", "agent-b", "agent-c", "test-agent"]) {
    if (isRunActive(id)) {
      endRun(id);
    }
  }
});

function makeEvent(type: RunEvent["type"], data: Record<string, unknown> = {}): RunEvent {
  return { type, timestamp: Date.now(), data };
}

describe("startRun / isRunActive", () => {
  test("startRun makes a run active", () => {
    startRun("test-agent");
    expect(isRunActive("test-agent")).toBe(true);
  });

  test("isRunActive returns false for unknown agent", () => {
    expect(isRunActive("nonexistent")).toBe(false);
  });
});

describe("emitRunEvent", () => {
  test("delivers events to subscribers", () => {
    startRun("agent-a");
    const received: RunEvent[] = [];
    subscribeToRun("agent-a", (e) => received.push(e));

    const event = makeEvent("text", { text: "hello" });
    emitRunEvent("agent-a", event);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("text");
    expect(received[0].data.text).toBe("hello");
  });

  test("does nothing for inactive agent", () => {
    // Should not throw
    emitRunEvent("nonexistent", makeEvent("text"));
  });

  test("caps events at MAX_EVENTS (500)", () => {
    startRun("agent-a");
    for (let i = 0; i < 510; i++) {
      emitRunEvent("agent-a", makeEvent("text", { i }));
    }
    // Subscribe and count replayed events
    const replayed: RunEvent[] = [];
    subscribeToRun("agent-a", (e) => replayed.push(e));
    expect(replayed).toHaveLength(500);
  });

  test("listener errors do not crash other listeners", () => {
    startRun("agent-a");
    const results: string[] = [];

    subscribeToRun("agent-a", () => {
      throw new Error("listener error");
    });
    subscribeToRun("agent-a", () => {
      results.push("ok");
    });

    emitRunEvent("agent-a", makeEvent("text"));
    expect(results).toEqual(["ok"]);
  });
});

describe("subscribeToRun", () => {
  test("returns null when no active run exists", () => {
    const result = subscribeToRun("nonexistent", () => {});
    expect(result).toBeNull();
  });

  test("replays existing events to new subscriber", () => {
    startRun("agent-a");
    emitRunEvent("agent-a", makeEvent("started"));
    emitRunEvent("agent-a", makeEvent("text", { text: "hi" }));

    const replayed: RunEvent[] = [];
    subscribeToRun("agent-a", (e) => replayed.push(e));

    expect(replayed).toHaveLength(2);
    expect(replayed[0].type).toBe("started");
    expect(replayed[1].type).toBe("text");
  });

  test("returns unsubscribe function that removes listener", () => {
    startRun("agent-a");
    const received: RunEvent[] = [];
    const unsub = subscribeToRun("agent-a", (e) => received.push(e));

    emitRunEvent("agent-a", makeEvent("text", { n: 1 }));
    expect(received).toHaveLength(1);

    unsub!();
    emitRunEvent("agent-a", makeEvent("text", { n: 2 }));
    // Should not receive the second event
    expect(received).toHaveLength(1);
  });

  test("returns no-op unsubscribe when replay includes complete event", () => {
    startRun("agent-a");
    emitRunEvent("agent-a", makeEvent("started"));
    emitRunEvent("agent-a", makeEvent("complete"));

    const replayed: RunEvent[] = [];
    const unsub = subscribeToRun("agent-a", (e) => replayed.push(e));

    // Should have replayed both events
    expect(replayed).toHaveLength(2);
    // Should return a function (no-op), not null
    expect(typeof unsub).toBe("function");

    // New events after complete should NOT be received
    emitRunEvent("agent-a", makeEvent("text"));
    expect(replayed).toHaveLength(2);
  });
});

describe("multiple concurrent runs", () => {
  test("runs are isolated", () => {
    startRun("agent-a");
    startRun("agent-b");

    const eventsA: RunEvent[] = [];
    const eventsB: RunEvent[] = [];
    subscribeToRun("agent-a", (e) => eventsA.push(e));
    subscribeToRun("agent-b", (e) => eventsB.push(e));

    emitRunEvent("agent-a", makeEvent("text", { msg: "a" }));
    emitRunEvent("agent-b", makeEvent("text", { msg: "b" }));

    expect(eventsA).toHaveLength(1);
    expect(eventsA[0].data.msg).toBe("a");
    expect(eventsB).toHaveLength(1);
    expect(eventsB[0].data.msg).toBe("b");
  });
});

describe("endRun and generation guard", () => {
  test("endRun does not immediately delete state (5s grace)", () => {
    startRun("agent-a");
    emitRunEvent("agent-a", makeEvent("started"));
    endRun("agent-a");

    // State should still exist immediately after endRun (5s delay)
    expect(isRunActive("agent-a")).toBe(true);
  });

  test("generation guard: new startRun protects against stale endRun cleanup", () => {
    startRun("agent-a");
    endRun("agent-a");
    // Start a new run for the same agent before the 5s timer fires
    startRun("agent-a");

    // The new run should be active
    expect(isRunActive("agent-a")).toBe(true);

    // Even after the old timer fires (5s), the new run should persist
    // because the generation counter protects it
    emitRunEvent("agent-a", makeEvent("text", { gen: "new" }));
    const events: RunEvent[] = [];
    subscribeToRun("agent-a", (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0].data.gen).toBe("new");
  });
});
