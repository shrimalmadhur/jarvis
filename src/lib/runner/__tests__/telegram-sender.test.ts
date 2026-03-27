import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { RunResult } from "../types";

// Mock node-fetch so sendTelegramMessage doesn't make real HTTP calls.
// This avoids mocking @/lib/notifications/telegram which would leak to other test files.
let capturedFetchCalls: Array<{ url: string; body: string }> = [];
const mockNodeFetch = mock(async (url: string, opts: { body: string }) => {
  capturedFetchCalls.push({ url, body: opts.body });
  return { ok: true };
});
mock.module("node-fetch", () => ({ default: mockNodeFetch }));
mock.module("@/lib/telegram/api", () => ({ ipv4Agent: null }));

// Mock the DB for getAgentTelegramConfig
const mockLimit = mock(async () => [] as unknown[]);
const mockWhere = mock(() => ({ limit: mockLimit }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));

mock.module("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ field: a, value: b }),
  and: (...args: unknown[]) => ({ and: args }),
}));

mock.module("@/lib/db", () => ({
  db: { select: mockSelect },
}));

mock.module("@/lib/db/schema", () => ({
  notificationConfigs: {
    channel: "channel",
    enabled: "enabled",
  },
}));

const { getAgentTelegramConfig, sendAgentResult, sendAgentError } = await import("../telegram-sender");

beforeEach(() => {
  capturedFetchCalls = [];
  mockNodeFetch.mockClear();
  mockLimit.mockReset();
  mockLimit.mockImplementation(async () => []);
});

function makeRunResult(overrides?: Partial<RunResult>): RunResult {
  return {
    agentName: "test-agent",
    success: true,
    output: "Agent completed task.",
    model: "gemini-3-flash",
    tokensUsed: { prompt: 100, completion: 200 },
    toolUses: [],
    durationMs: 5000,
    ...overrides,
  };
}

describe("getAgentTelegramConfig", () => {
  test("returns config from agentId-based channel", async () => {
    mockLimit.mockImplementationOnce(async () => [
      { config: { bot_token: "bot123", chat_id: "chat456" }, enabled: true },
    ]);

    const result = await getAgentTelegramConfig("test-agent", "agent-id-1");
    expect(result).toEqual({ botToken: "bot123", chatId: "chat456" });
  });

  test("falls back to agentName-based channel when agentId query returns empty", async () => {
    // First call (agentId): empty
    mockLimit.mockImplementationOnce(async () => []);
    // Second call (agentName): returns config
    mockLimit.mockImplementationOnce(async () => [
      { config: { bot_token: "name-bot", chat_id: "name-chat" }, enabled: true },
    ]);

    const result = await getAgentTelegramConfig("test-agent", "agent-id-1");
    expect(result).toEqual({ botToken: "name-bot", chatId: "name-chat" });
  });

  test("returns null when neither lookup finds config", async () => {
    mockLimit.mockImplementation(async () => []);

    const result = await getAgentTelegramConfig("test-agent", "agent-id-1");
    expect(result).toBeNull();
  });

  test("skips agentId lookup when agentId is undefined", async () => {
    mockLimit.mockImplementationOnce(async () => [
      { config: { bot_token: "bot", chat_id: "chat" }, enabled: true },
    ]);

    const result = await getAgentTelegramConfig("test-agent");
    expect(result).toEqual({ botToken: "bot", chatId: "chat" });
  });

  test("returns null when config lacks bot_token or chat_id", async () => {
    mockLimit.mockImplementationOnce(async () => [
      { config: { bot_token: "", chat_id: "chat" }, enabled: true },
    ]);
    // Falls through to agentName lookup:
    mockLimit.mockImplementationOnce(async () => []);

    const result = await getAgentTelegramConfig("test-agent", "id");
    expect(result).toBeNull();
  });
});

describe("sendAgentResult", () => {
  const telegramConfig = { botToken: "bot", chatId: "chat" };

  test("sends message with metadata", async () => {
    await sendAgentResult(telegramConfig, "test-agent", makeRunResult());

    expect(capturedFetchCalls).toHaveLength(1);
    const body = JSON.parse(capturedFetchCalls[0].body);
    expect(body.text).toContain("gemini-3-flash");
    expect(body.text).toContain("300"); // total tokens
    expect(body.text).toContain("5.0s");
    expect(body.parse_mode).toBe("HTML");
  });

  test("truncates long output", async () => {
    const longOutput = "x".repeat(5000);
    await sendAgentResult(telegramConfig, "test-agent", makeRunResult({ output: longOutput }));

    const body = JSON.parse(capturedFetchCalls[0].body);
    // Output should be truncated with "..."
    expect(body.text).toContain("...");
  });
});

describe("sendAgentError", () => {
  const telegramConfig = { botToken: "bot", chatId: "chat" };

  test("sends error message with FAILED prefix", async () => {
    await sendAgentError(
      telegramConfig,
      "test-agent",
      makeRunResult({ success: false, error: "Something went wrong" })
    );

    expect(capturedFetchCalls).toHaveLength(1);
    const body = JSON.parse(capturedFetchCalls[0].body);
    expect(body.text).toContain("[FAILED]");
    expect(body.text).toContain("test-agent");
    expect(body.text).toContain("Something went wrong");
  });

  test("uses 'Unknown error' when error is undefined", async () => {
    await sendAgentError(
      telegramConfig,
      "test-agent",
      makeRunResult({ success: false })
    );

    const body = JSON.parse(capturedFetchCalls[0].body);
    expect(body.text).toContain("Unknown error");
  });
});
