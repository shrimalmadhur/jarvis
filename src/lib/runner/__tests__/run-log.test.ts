import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { RunResult } from "../types";

// Mock DB with builder chain including .returning()
const mockReturning = mock(async () => [{ id: "run-123" }] as unknown[]);
const mockValues = mock((..._args: unknown[]) => ({ returning: mockReturning }));
const mockInsert = mock(() => ({ values: mockValues }));

// Second insert for tool uses (no returning)
const mockToolValues = mock(async () => {});
let insertCallCount = 0;
const smartInsert = mock((_table: unknown) => {
  insertCallCount++;
  if (insertCallCount % 2 === 1) {
    // First insert: agentRuns (with returning)
    return { values: mockValues };
  }
  // Second insert: agentRunToolUses (no returning)
  return { values: mockToolValues };
});

mock.module("@/lib/db", () => ({
  db: { insert: smartInsert },
}));

mock.module("@/lib/db/schema", () => ({
  agentRuns: { __table: "agentRuns" },
  agentRunToolUses: { __table: "agentRunToolUses" },
}));

const { logRun } = await import("../run-log");

beforeEach(() => {
  mockValues.mockClear();
  mockReturning.mockClear();
  mockToolValues.mockClear();
  smartInsert.mockClear();
  insertCallCount = 0;
  mockReturning.mockImplementation(async () => [{ id: "run-123" }]);
});

function makeRunResult(overrides?: Partial<RunResult>): RunResult {
  return {
    agentName: "test-agent",
    success: true,
    output: "completed",
    model: "gemini-3-flash",
    tokensUsed: { prompt: 100, completion: 200 },
    toolUses: [],
    durationMs: 5000,
    ...overrides,
  };
}

describe("logRun", () => {
  test("inserts run with correct field mapping", async () => {
    await logRun(makeRunResult());

    expect(smartInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalled();

    const valuesArg = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(valuesArg.agentName).toBe("test-agent");
    expect(valuesArg.status).toBe("success");
    expect(valuesArg.output).toBe("completed");
    expect(valuesArg.model).toBe("gemini-3-flash");
    expect(valuesArg.promptTokens).toBe(100);
    expect(valuesArg.completionTokens).toBe(200);
    expect(valuesArg.durationMs).toBe(5000);
    expect(valuesArg.toolUseCount).toBe(0);
  });

  test("maps success=false to status='error'", async () => {
    await logRun(makeRunResult({ success: false, error: "boom" }));

    const valuesArg = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(valuesArg.status).toBe("error");
    expect(valuesArg.error).toBe("boom");
  });

  test("uses null for optional fields when undefined", async () => {
    await logRun(makeRunResult());

    const valuesArg = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(valuesArg.agentId).toBeNull();
    expect(valuesArg.error).toBeNull();
    expect(valuesArg.claudeSessionId).toBeNull();
    expect(valuesArg.claudeSessionProjectDir).toBeNull();
  });

  test("inserts tool uses when present", async () => {
    await logRun(makeRunResult({
      toolUses: [
        { toolName: "search", toolInput: '{"q":"test"}', toolOutput: "result", isError: false, durationMs: 100 },
        { toolName: "read", isError: true },
      ],
    }));

    // Should have been called twice: once for agentRuns, once for toolUses
    expect(smartInsert).toHaveBeenCalledTimes(2);
    expect(mockToolValues).toHaveBeenCalled();

    const toolValues = (mockToolValues.mock.calls as unknown as Array<[Array<Record<string, unknown>>]>)[0][0];
    expect(toolValues).toHaveLength(2);
    expect(toolValues[0].toolName).toBe("search");
    expect(toolValues[0].runId).toBe("run-123");
    expect(toolValues[1].toolName).toBe("read");
    expect(toolValues[1].isError).toBe(true);
  });

  test("does not insert tool uses when toolUses is empty", async () => {
    await logRun(makeRunResult({ toolUses: [] }));

    // Only one insert call (agentRuns)
    expect(smartInsert).toHaveBeenCalledTimes(1);
  });
});
