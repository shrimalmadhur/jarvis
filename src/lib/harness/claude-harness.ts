import { spawn } from "node:child_process";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { PHASE_TIMEOUT_MS } from "@/lib/issues/types";
import { DENIED_ENV_KEYS } from "@/lib/validations/constants";
import type { HarnessPhaseOpts, HarnessPhaseResult } from "./types";

/** Allowed env var names for Claude CLI child processes. */
const CLAUDE_ALLOWED_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "TMPDIR", "XDG_CONFIG_HOME",
  "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CLAUDE_CODE_API_KEY",
  "GH_TOKEN", "GITHUB_TOKEN",
]);

/** Build a minimal env for Claude CLI — only pass through what's needed. */
export function buildClaudeEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of CLAUDE_ALLOWED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (!DENIED_ENV_KEYS.has(key.toUpperCase())) env[key] = value;
    }
  }
  return env as unknown as NodeJS.ProcessEnv;
}

export const MAX_FALLBACK_CHARS = 50_000;

/**
 * Run a single phase via Claude CLI.
 *
 * Spawns `claude -p --verbose --output-format stream-json --dangerously-skip-permissions`.
 * Optionally passes `-w <name>` on the first phase to let Claude create a worktree,
 * `--session-id` for new sessions, `--resume` to continue a session,
 * and `--append-system-prompt` for system prompts.
 */
export async function runClaudeHarness(opts: HarnessPhaseOpts): Promise<HarnessPhaseResult> {
  const effectiveSessionId = opts.resumeSessionId || opts.sessionId || crypto.randomUUID();

  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];

  // Worktree creation (first phase only)
  if (opts.worktreeName && !opts.resumeSessionId) {
    args.push("-w", opts.worktreeName);
  }

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  } else {
    args.push("--session-id", effectiveSessionId);
  }

  // System prompt only on creation (resumed sessions inherit it)
  if (opts.systemPrompt && !opts.resumeSessionId) {
    args.push("--append-system-prompt", opts.systemPrompt);
  }

  const timeout = opts.timeoutMs || PHASE_TIMEOUT_MS;
  const env = buildClaudeEnv(opts.envOverrides);

  return new Promise<HarnessPhaseResult>((resolve) => {
    const proc = spawn(resolveClaudePath(), args, {
      cwd: opts.workdir,
      env,
    });

    proc.stdin!.write(opts.prompt);
    proc.stdin!.end();

    let buffer = "";
    let resultText = "";
    const assistantBlocks: string[] = [];
    let assistantBlocksSize = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already dead */ } }, 30000);
    }, timeout);

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.length > 1_000_000) buffer = buffer.slice(-500_000);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "result" && event.result) {
            resultText = event.result;
          }
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text && assistantBlocksSize < MAX_FALLBACK_CHARS) {
                assistantBlocks.push(block.text);
                assistantBlocksSize += block.text.length;
              }
            }
          }
        } catch { /* skip non-JSON lines */ }
      }
    });

    let stderrOutput = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.length > 10000) stderrOutput = stderrOutput.slice(-10000);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === "result" && event.result) resultText = event.result;
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text && assistantBlocksSize < MAX_FALLBACK_CHARS) {
                assistantBlocks.push(block.text);
                assistantBlocksSize += block.text.length;
              }
            }
          }
        } catch { /* ignore */ }
      }

      if (resultText.length > MAX_FALLBACK_CHARS) {
        resultText = resultText.substring(0, MAX_FALLBACK_CHARS);
      }

      let output = resultText.trim() || assistantBlocks.join("\n\n");
      if (timedOut) output = `[TIMEOUT after ${timeout / 1000}s] ${output}`;
      if (!output && stderrOutput) output = stderrOutput;

      const hasQuestions = /##\s*Questions/i.test(output);
      const questions = hasQuestions
        ? output.substring(output.search(/##\s*Questions/i))
        : undefined;

      resolve({
        success: code === 0 && !timedOut,
        output,
        sessionId: effectiveSessionId,
        hasQuestions,
        questions,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: err.message, sessionId: effectiveSessionId });
    });
  });
}
