import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

// Mock resolveClaudePath to point to our mock script
const MOCK_CLAUDE_PATH = join(import.meta.dir, "mock-claude.sh");

mock.module("@/lib/utils/resolve-claude-path", () => ({
  resolveClaudePath: () => MOCK_CLAUDE_PATH,
}));

// Must import after mock setup
const { runAgentTask, getAgentWorkspaceDir } = await import("../agent-runner");
const { readWorkspaceMemory } = await import("../agent-memory");

import type { AgentDefinition } from "../types";
import type { RunEvent } from "../run-events";

const TEST_CWD = join(import.meta.dir, ".tmp-test-runner");

function makeDefinition(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    config: {
      name: "test-agent",
      enabled: true,
      schedule: "0 9 * * *",
    },
    soul: "You are a test agent.",
    skill: "## Task\nAnalyze something.\n\n## Memory\nTrack items analyzed.",
    agentId: "test-agent-id",
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_CWD, { recursive: true });
  // Ensure mock script is executable
  chmodSync(MOCK_CLAUDE_PATH, 0o755);
  // Override cwd for workspace resolution
  const origCwd = process.cwd;
  process.cwd = () => TEST_CWD;
  // Store for cleanup
  (globalThis as Record<string, unknown>).__origCwd = origCwd;
});

afterEach(() => {
  const origCwd = (globalThis as Record<string, unknown>).__origCwd as typeof process.cwd;
  if (origCwd) process.cwd = origCwd;
  rmSync(TEST_CWD, { recursive: true, force: true });
});

describe("runAgentTask", () => {
  test("captures main agent output as resultText, not intermediate text", async () => {
    process.env.MOCK_CLAUDE_MODE = "success";
    const def = makeDefinition();
    const result = await runAgentTask(def);

    expect(result.success).toBe(true);
    expect(result.output).toContain("full analysis of ingredient X");
    expect(result.output).toContain("75/100");
    expect(result.output).not.toMatch(/^memory updated/i);
  });

  test("captures tool use events", async () => {
    process.env.MOCK_CLAUDE_MODE = "success_with_tools";
    const events: RunEvent[] = [];
    const def = makeDefinition();
    const result = await runAgentTask(def, (e) => events.push(e));

    expect(result.success).toBe(true);
    expect(result.output).toContain("85/100");

    const toolStarts = events.filter((e) => e.type === "tool_start");
    expect(toolStarts.length).toBeGreaterThanOrEqual(1);
    expect((toolStarts[0].data as Record<string, unknown>).toolName).toBe("read_file");
  });

  test("memory sub-agent called after successful main run", async () => {
    process.env.MOCK_CLAUDE_MODE = "success";
    const events: RunEvent[] = [];
    const def = makeDefinition();
    await runAgentTask(def, (e) => events.push(e));

    const memEvents = events.filter((e) => e.type === "memory_update");
    expect(memEvents.length).toBeGreaterThanOrEqual(1);
    expect((memEvents[0].data as Record<string, unknown>).status).toBe("started");
  });

  test("memory sub-agent NOT called after failed main run", async () => {
    process.env.MOCK_CLAUDE_MODE = "failure";
    const events: RunEvent[] = [];
    const def = makeDefinition();
    const result = await runAgentTask(def, (e) => events.push(e));

    expect(result.success).toBe(false);
    const memEvents = events.filter((e) => e.type === "memory_update");
    expect(memEvents.length).toBe(0);
  });

  test("main run failure does not crash the runner", async () => {
    process.env.MOCK_CLAUDE_MODE = "failure";
    const def = makeDefinition();
    const result = await runAgentTask(def);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("result includes claudeSessionId as valid UUID and claudeSessionProjectDir", async () => {
    process.env.MOCK_CLAUDE_MODE = "success";
    const def = makeDefinition();
    const result = await runAgentTask(def);

    expect(result.claudeSessionId).toBeDefined();
    expect(result.claudeSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(result.claudeSessionProjectDir).toBeDefined();
    expect(result.claudeSessionProjectDir!.length).toBeGreaterThan(0);
  });

  test("claudeSessionId is set even on failed runs", async () => {
    process.env.MOCK_CLAUDE_MODE = "failure";
    const def = makeDefinition();
    const result = await runAgentTask(def);

    expect(result.success).toBe(false);
    expect(result.claudeSessionId).toBeDefined();
    expect(result.claudeSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("system prompt does NOT contain write-memory instructions", async () => {
    // We can't directly inspect the system prompt sent to CLI from here,
    // but we verify the constant used doesn't have write instructions
    const { MEMORY_CONTEXT_NOTE } = await import("../agent-memory");
    expect(MEMORY_CONTEXT_NOTE.toLowerCase()).not.toContain("update `./memory.md`");
    expect(MEMORY_CONTEXT_NOTE.toLowerCase()).not.toContain("write_file");
    expect(MEMORY_CONTEXT_NOTE.toLowerCase()).toContain("do not write to memory.md");
  });
});

describe("getAgentWorkspaceDir", () => {
  test("uses agentId when available", () => {
    const def = makeDefinition({ agentId: "abc-123" });
    const dir = getAgentWorkspaceDir(def);
    expect(dir).toContain("abc-123");
  });

  test("sanitizes agent name for filesystem agents", () => {
    const def = makeDefinition({ agentId: undefined });
    def.config.name = "my agent/name";
    const dir = getAgentWorkspaceDir(def);
    expect(dir).not.toContain("/name");
    expect(dir).toContain("my_agent_name");
  });
});
