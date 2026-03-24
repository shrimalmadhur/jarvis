import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition, RunResult, ToolUseLog } from "./types";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import type { RunEvent } from "./run-events";
import { readWorkspaceMemory, formatMemoryForPrompt, MEMORY_CONTEXT_NOTE, AGENT_OUTPUT_RULES, updateMemoryAfterRun, buildChildEnv, hasWorkspaceArchive } from "./agent-memory";

/** State accumulated while processing JSONL stream events from Claude CLI */
interface StreamState {
  resultText: string;
  assistantTextBlocks: string[];
  model: string;
  promptTokens: number;
  completionTokens: number;
  toolUses: ToolUseLog[];
  pendingTools: Map<string, { name: string; input: string; startTime: number }>;
}

function createStreamState(): StreamState {
  return {
    resultText: "",
    assistantTextBlocks: [],
    model: "claude",
    promptTokens: 0,
    completionTokens: 0,
    toolUses: [],
    pendingTools: new Map(),
  };
}

/** Process a single parsed JSONL event from the Claude CLI stream */
function processStreamEvent(
  event: Record<string, unknown>,
  state: StreamState,
  onEvent?: (event: RunEvent) => void
): void {
  if (event.type === "result") {
    if (event.result) state.resultText = event.result as string;
    if (event.input_tokens) state.promptTokens = event.input_tokens as number;
    if (event.output_tokens) state.completionTokens = event.output_tokens as number;
    if (event.model) state.model = event.model as string;
    return;
  }

  if (event.type === "assistant" && (event.message as Record<string, unknown>)?.content) {
    const msg = event.message as Record<string, unknown>;
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use") {
          state.pendingTools.set(block.id, {
            name: block.name,
            input: JSON.stringify(block.input || {}),
            startTime: Date.now(),
          });
          onEvent?.({
            type: "tool_start",
            timestamp: Date.now(),
            data: {
              toolName: block.name,
              toolInput: JSON.stringify(block.input || {}).substring(0, 2000),
            },
          });
        } else if (block.type === "text" && block.text) {
          state.assistantTextBlocks.push(block.text);
          onEvent?.({
            type: "text",
            timestamp: Date.now(),
            data: { text: block.text },
          });
        }
      }
    }
    if (msg.model) state.model = msg.model as string;
    return;
  }

  if (event.type === "user" && (event.message as Record<string, unknown>)?.content) {
    const content = (event.message as Record<string, unknown>).content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue;
      const pending = state.pendingTools.get(block.tool_use_id);
      if (!pending) continue;

      let outputText: string;
      if (typeof block.content === "string") {
        outputText = block.content;
      } else if (Array.isArray(block.content)) {
        outputText = block.content.map((c: { text?: string }) => c.text || "").join("");
      } else {
        outputText = JSON.stringify(block.content);
      }

      const toolDurationMs = Date.now() - pending.startTime;
      state.toolUses.push({
        toolName: pending.name,
        toolInput: pending.input.substring(0, 4000),
        toolOutput: outputText.substring(0, 4000),
        isError: block.is_error || false,
        durationMs: toolDurationMs,
      });
      onEvent?.({
        type: "tool_result",
        timestamp: Date.now(),
        data: {
          toolName: pending.name,
          toolOutput: outputText.substring(0, 2000),
          isError: block.is_error || false,
          durationMs: toolDurationMs,
        },
      });
      state.pendingTools.delete(block.tool_use_id);
    }
  }
}

/** Build fallback output from assistant text blocks, capped at maxChars */
function buildFallbackOutput(blocks: string[], maxChars: number): string {
  let output = blocks.length > 0 ? blocks.join("\n\n") : "";
  if (output.length > maxChars) {
    output = "[earlier output truncated]\n\n" + output.substring(output.length - maxChars);
  }
  return output;
}

/**
 * Build the user message from skill + context.
 */
function buildUserMessage(
  definition: AgentDefinition,
  context?: { workspaceMemory?: string; hasArchive?: boolean }
): string {
  const parts: string[] = [];

  parts.push(`## Context`);
  parts.push(`Today's date: ${new Date().toISOString().split("T")[0]}`);

  // Tell the agent about its persistent workspace
  parts.push("");
  parts.push(`## Your Workspace`);
  parts.push("You are running in a persistent workspace directory dedicated to you.");
  parts.push("This directory survives across runs — files you create, packages you install,");
  parts.push("and any other state will still be here next time you run.");
  parts.push("Use this workspace freely for caching data, storing intermediate results, or any other purpose.");

  // List available env vars so Claude knows what's available
  const envVars = definition.config.envVars;
  if (envVars && Object.keys(envVars).length > 0) {
    parts.push("");
    parts.push(`## Available Environment Variables`);
    parts.push("The following environment variables are set in your environment:");
    for (const key of Object.keys(envVars)) {
      parts.push(`- \`${key}\``);
    }
    parts.push("");
    parts.push("Use these to access external services as needed for your task.");
  }

  // Inject workspace memory (agent's own persistent memory file)
  if (context?.workspaceMemory) {
    parts.push("");
    parts.push(formatMemoryForPrompt(context.workspaceMemory, context.hasArchive));
  }

  parts.push("");
  parts.push(definition.skill);

  return parts.join("\n");
}

/**
 * Resolve the workspace directory for an agent.
 */
export function getAgentWorkspaceDir(definition: AgentDefinition): string {
  const safeDirName = definition.agentId || definition.config.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(process.cwd(), "data", "workspaces", safeDirName);
}

/**
 * Run an agent task via Claude CLI using two-phase execution.
 *
 * Phase 1 (Main Agent): Spawns `claude -p` with the agent's env vars and full
 * tool access. The system prompt includes read-only memory context — no memory
 * write instructions. The agent focuses purely on its core task.
 *
 * Phase 2 (Memory Sub-Agent): After the main agent exits successfully, spawns
 * a lightweight Claude CLI invocation (no tools) to update memory.md based on
 * what the main agent produced. This is best-effort and non-fatal.
 *
 * This two-phase approach structurally guarantees the result text is the
 * agent's deliverable, not a housekeeping remark like "Memory updated...".
 */
export async function runAgentTask(
  definition: AgentDefinition,
  onEvent?: (event: RunEvent) => void
): Promise<RunResult> {
  const startTime = Date.now();

  // Create a persistent workspace directory for this agent so it can
  // install packages, write temp files, etc. across runs.
  const workspaceDir = getAgentWorkspaceDir(definition);
  mkdirSync(workspaceDir, { recursive: true });

  // Read the agent's persistent memory file from its workspace
  const workspaceMemory = readWorkspaceMemory(workspaceDir);
  const archiveExists = hasWorkspaceArchive(workspaceDir);

  const prompt = buildUserMessage(definition, { workspaceMemory, hasArchive: archiveExists });

  // Append system-level rules to the agent's soul:
  // 1. Memory context (read-only — updates handled by Phase 2 sub-agent)
  // 2. Output rules (deliverable-only output, no housekeeping remarks)
  const systemPrompt = definition.soul + MEMORY_CONTEXT_NOTE + AGENT_OUTPUT_RULES;

  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--append-system-prompt", systemPrompt,
  ];

  const childEnv = buildChildEnv(definition.config.envVars);

  const AGENT_TIMEOUT_MS = 10 * 60 * 1000;   // 10 minutes
  const MAX_FALLBACK_CHARS = 50_000;           // 50KB cap on fallback output

  // Phase 1: Run the main agent
  const result = await new Promise<RunResult>((resolve) => {
    const proc: ChildProcess = spawn(resolveClaudePath(), args, {
      env: childEnv,
      cwd: workspaceDir,
    });

    let agentTimedOut = false;
    const agentTimer = setTimeout(() => {
      agentTimedOut = true;
      proc.kill("SIGTERM");
    }, AGENT_TIMEOUT_MS);

    proc.stdin!.write(prompt);
    proc.stdin!.end();

    let buffer = "";
    const state = createStreamState();

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          processStreamEvent(JSON.parse(trimmed), state, onEvent);
        } catch {
          // Not valid JSON, skip
        }
      }
    });

    let stderrOutput = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.length > 10000) stderrOutput = stderrOutput.slice(-10000);
    });

    const buildResult = (success: boolean, durationMs: number, error?: string): RunResult => ({
      agentName: definition.config.name,
      agentId: definition.agentId,
      success,
      output: success ? (state.resultText.trim() || buildFallbackOutput(state.assistantTextBlocks, MAX_FALLBACK_CHARS)) : "",
      model: state.model,
      tokensUsed: { prompt: state.promptTokens, completion: state.completionTokens },
      toolUses: state.toolUses,
      durationMs,
      ...(error ? { error } : {}),
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(agentTimer);
      const durationMs = Date.now() - startTime;
      const isSuccess = code === 0;

      if (isSuccess) {
        const output = state.resultText.trim() || buildFallbackOutput(state.assistantTextBlocks, MAX_FALLBACK_CHARS);
        resolve({ ...buildResult(true, durationMs), output });
      } else {
        const error = agentTimedOut
          ? `Agent timed out after ${AGENT_TIMEOUT_MS / 1000}s`
          : (stderrOutput || `Claude CLI exited with code ${code}`);
        resolve({ ...buildResult(false, durationMs, error), output: state.resultText.trim() || buildFallbackOutput(state.assistantTextBlocks, MAX_FALLBACK_CHARS) });
      }
    });

    proc.on("error", (err: Error) => {
      clearTimeout(agentTimer);
      resolve(buildResult(false, Date.now() - startTime, err.message));
    });
  });

  // Phase 2: Memory sub-agent (best-effort, non-fatal)
  if (result.success && result.output) {
    try {
      onEvent?.({
        type: "memory_update",
        timestamp: Date.now(),
        data: { status: "started" },
      });

      await updateMemoryAfterRun({
        workspaceDir,
        currentMemory: workspaceMemory,
        runOutput: result.output,
        skill: definition.skill,
        envVars: definition.config.envVars,
      });

      onEvent?.({
        type: "memory_update",
        timestamp: Date.now(),
        data: { status: "completed" },
      });
    } catch (err) {
      console.warn("[runner] memory sub-agent failed (non-fatal):", err);
      onEvent?.({
        type: "memory_update",
        timestamp: Date.now(),
        data: { status: "failed", error: String(err) },
      });
    }
  }

  return result;
}
