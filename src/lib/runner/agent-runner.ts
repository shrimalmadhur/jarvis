import { spawn, type ChildProcess } from "node:child_process";
import type { AgentDefinition, RunResult, ToolUseLog } from "./types";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";

/**
 * Build the user message from skill + context.
 */
function buildUserMessage(
  definition: AgentDefinition,
  context?: { recentOutputs?: string[] }
): string {
  const parts: string[] = [];

  parts.push(`## Context`);
  parts.push(`Today's date: ${new Date().toISOString().split("T")[0]}`);

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

  if (context?.recentOutputs?.length) {
    parts.push("");
    parts.push(`## Recent outputs (do NOT repeat these topics)`);
    for (const output of context.recentOutputs.slice(0, 10)) {
      const firstLine = output.split("\n")[0].substring(0, 100);
      parts.push(`- ${firstLine}`);
    }
  }

  parts.push("");
  parts.push(definition.skill);

  return parts.join("\n");
}

/**
 * Run an agent task via Claude CLI.
 * Spawns `claude -p` with the agent's env vars and full tool access.
 * Parses stream-json output for tool use logging.
 */
export async function runAgentTask(
  definition: AgentDefinition,
  context?: { recentOutputs?: string[] }
): Promise<RunResult> {
  const startTime = Date.now();
  const userMessage = buildUserMessage(definition, context);

  // Build the full prompt: soul as system prompt context + user message
  const prompt = userMessage;

  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--append-system-prompt", definition.soul,
  ];

  // Merge agent env vars with process env (deny-list dangerous keys)
  const DENIED_ENV_KEYS = new Set([
    "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS",
    "HOME", "SHELL", "USER", "LOGNAME", "DYLD_INSERT_LIBRARIES",
  ]);
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  const envVars = definition.config.envVars;
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      if (!DENIED_ENV_KEYS.has(key.toUpperCase())) {
        childEnv[key] = value;
      }
    }
  }
  childEnv.FORCE_COLOR = "0";

  const AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  return new Promise<RunResult>((resolve) => {
    const proc: ChildProcess = spawn(resolveClaudePath(), args, {
      env: childEnv,
    });

    const agentTimer = setTimeout(() => {
      proc.kill("SIGTERM");
    }, AGENT_TIMEOUT_MS);

    proc.stdin!.write(prompt);
    proc.stdin!.end();

    let buffer = "";
    let resultText = "";
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
            if (event.cost_usd !== undefined) {
              // stream-json result includes token usage in some versions
            }
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
                    const outputText = typeof block.content === "string"
                      ? block.content
                      : Array.isArray(block.content)
                        ? block.content.map((c: { text?: string }) => c.text || "").join("")
                        : JSON.stringify(block.content);

                    toolUses.push({
                      toolName: pending.name,
                      toolInput: pending.input.substring(0, 4000),
                      toolOutput: outputText.substring(0, 4000),
                      isError: block.is_error || false,
                      durationMs: Date.now() - pending.startTime,
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

      if (code !== 0 && !resultText) {
        resolve({
          agentName: definition.config.name,
          agentId: definition.agentId,
          success: false,
          output: "",
          model,
          tokensUsed: { prompt: promptTokens, completion: completionTokens },
          toolUses,
          durationMs,
          error: stderrOutput || `Claude CLI exited with code ${code}`,
        });
        return;
      }

      resolve({
        agentName: definition.config.name,
        agentId: definition.agentId,
        success: true,
        output: resultText,
        model,
        tokensUsed: { prompt: promptTokens, completion: completionTokens },
        toolUses,
        durationMs,
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
}
