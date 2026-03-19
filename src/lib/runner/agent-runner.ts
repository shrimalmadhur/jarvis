import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition, RunResult, ToolUseLog } from "./types";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import type { RunEvent } from "./run-events";
import { readWorkspaceMemory, formatMemoryForPrompt, MEMORY_CONTEXT_NOTE, AGENT_OUTPUT_RULES, updateMemoryAfterRun, buildChildEnv, hasWorkspaceArchive } from "./agent-memory";

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
    let resultText = "";
    const assistantTextBlocks: string[] = [];
    let model = "claude";
    let promptTokens = 0;
    let completionTokens = 0;
    const toolUses: ToolUseLog[] = [];

    // Track in-flight tool calls by ID
    const pendingTools = new Map<string, { name: string; input: string; startTime: number }>();

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);

          // Capture result text
          if (event.type === "result") {
            if (event.result) resultText = event.result;
            if (event.input_tokens) promptTokens = event.input_tokens;
            if (event.output_tokens) completionTokens = event.output_tokens;
            if (event.model) model = event.model;
          }

          // Capture assistant messages for tool calls
          if (event.type === "assistant" && event.message?.content) {
            const content = event.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "tool_use") {
                  pendingTools.set(block.id, {
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
                  assistantTextBlocks.push(block.text);
                  onEvent?.({
                    type: "text",
                    timestamp: Date.now(),
                    data: { text: block.text },
                  });
                }
              }
            }
            // Capture model name
            if (event.message.model) model = event.message.model;
          }

          // Capture tool results
          if (event.type === "user" && event.message?.content) {
            const content = event.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "tool_result" && block.tool_use_id) {
                  const pending = pendingTools.get(block.tool_use_id);
                  if (pending) {
                    let outputText: string;
                    if (typeof block.content === "string") {
                      outputText = block.content;
                    } else if (Array.isArray(block.content)) {
                      outputText = block.content.map((c: { text?: string }) => c.text || "").join("");
                    } else {
                      outputText = JSON.stringify(block.content);
                    }

                    const toolDurationMs = Date.now() - pending.startTime;
                    toolUses.push({
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
                    pendingTools.delete(block.tool_use_id);
                  }
                }
              }
            }
          }
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

    proc.on("close", (code: number | null) => {
      clearTimeout(agentTimer);
      const durationMs = Date.now() - startTime;

      const isSuccess = code === 0;

      // resultText comes from the CLI's "result" event — the agent's final deliverable.
      // Fall back to ALL assistant text blocks (joined) if resultText is empty (e.g. crash).
      // Using all blocks instead of just the last one prevents losing the main deliverable
      // when the agent's final message is a short housekeeping remark.
      // Keeps the tail (most recent output) capped at 50KB to prevent DB bloat.
      let fallbackOutput = assistantTextBlocks.length > 0 ? assistantTextBlocks.join("\n\n") : "";
      if (fallbackOutput.length > MAX_FALLBACK_CHARS) {
        fallbackOutput = "[earlier output truncated]\n\n" + fallbackOutput.substring(fallbackOutput.length - MAX_FALLBACK_CHARS);
      }
      const finalOutput = resultText.trim() || fallbackOutput;

      resolve({
        agentName: definition.config.name,
        agentId: definition.agentId,
        success: isSuccess,
        output: finalOutput,
        model,
        tokensUsed: { prompt: promptTokens, completion: completionTokens },
        toolUses,
        durationMs,
        ...(isSuccess ? {} : {
          error: agentTimedOut
            ? `Agent timed out after ${AGENT_TIMEOUT_MS / 1000}s`
            : (stderrOutput || `Claude CLI exited with code ${code}`),
        }),
      });
    });

    proc.on("error", (err: Error) => {
      clearTimeout(agentTimer);
      resolve({
        agentName: definition.config.name,
        agentId: definition.agentId,
        success: false,
        output: "",
        model,
        tokensUsed: { prompt: promptTokens, completion: completionTokens },
        toolUses,
        durationMs: Date.now() - startTime,
        error: err.message,
      });
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
