import { spawn } from "node:child_process";
import { resolveCodexPath } from "./resolve-codex-path";
import { PHASE_TIMEOUT_MS } from "@/lib/issues/types";
import { DENIED_ENV_KEYS } from "@/lib/validations/constants";
import type { HarnessPhaseOpts, HarnessPhaseResult } from "./types";

const MAX_FALLBACK_CHARS = 50_000;

/** Allowed env var names for Codex CLI child processes. */
const CODEX_ALLOWED_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "TMPDIR", "XDG_CONFIG_HOME",
  "OPENAI_API_KEY",
  "GH_TOKEN", "GITHUB_TOKEN",
]);

/** Build a minimal env for Codex CLI. */
export function buildCodexEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of CODEX_ALLOWED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (!DENIED_ENV_KEYS.has(key.toUpperCase())) env[key] = value;
    }
  }
  return env as unknown as NodeJS.ProcessEnv;
}

/**
 * Run a single phase via Codex CLI.
 *
 * Fresh run:  `codex exec --json --dangerously-bypass-approvals-and-sandbox -C <workdir> --skip-git-repo-check -`
 * Resume:     `codex exec resume <thread_id> --json --dangerously-bypass-approvals-and-sandbox -C <workdir> -`
 *
 * System prompts are prepended to the user prompt (Codex has no --append-system-prompt).
 * Session IDs (thread_id) are extracted from the JSONL `thread.started` event.
 */
export async function runCodexHarness(opts: HarnessPhaseOpts): Promise<HarnessPhaseResult> {
  const args = ["exec"];

  // Resume mode
  if (opts.resumeSessionId) {
    args.push("resume", opts.resumeSessionId);
  }

  args.push(
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd", opts.workdir,
    "--skip-git-repo-check",
  );

  // One-shot phases (no resume needed later): avoid session clutter
  if (!opts.sessionId && !opts.resumeSessionId) {
    args.push("--ephemeral");
  }

  // Prompt from stdin
  args.push("-");

  const timeout = opts.timeoutMs || PHASE_TIMEOUT_MS;

  // Codex has no --append-system-prompt — prepend to user prompt
  let fullPrompt = opts.prompt;
  if (opts.systemPrompt && !opts.resumeSessionId) {
    fullPrompt = `## System Instructions\n${opts.systemPrompt}\n\n## Task\n${opts.prompt}`;
  }

  const env = buildCodexEnv(opts.envOverrides);

  return new Promise<HarnessPhaseResult>((resolve) => {
    const proc = spawn(resolveCodexPath(), args, {
      cwd: opts.workdir,
      env,
    });

    proc.stdin!.write(fullPrompt);
    proc.stdin!.end();

    let buffer = "";
    let threadId: string | undefined;
    const completedItems: string[] = [];
    let completedItemsSize = 0;
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

          // Capture thread_id from first event
          if (event.type === "thread.started" && event.thread_id) {
            threadId = event.thread_id;
          }

          // Capture completed agent messages only (skip command_execution, file_change, etc.)
          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message" &&
            event.item?.text
          ) {
            if (completedItemsSize < MAX_FALLBACK_CHARS) {
              completedItems.push(event.item.text);
              completedItemsSize += event.item.text.length;
            }
          }
        } catch { /* skip non-JSON */ }
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
          if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id;
          if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item?.text) {
            if (completedItemsSize < MAX_FALLBACK_CHARS) {
              completedItems.push(event.item.text);
              completedItemsSize += event.item.text.length;
            }
          }
        } catch { /* ignore */ }
      }

      let output = completedItems.join("\n\n");
      if (output.length > MAX_FALLBACK_CHARS) {
        output = output.substring(0, MAX_FALLBACK_CHARS);
      }
      if (timedOut) output = `[TIMEOUT after ${timeout / 1000}s] ${output}`;
      if (!output && stderrOutput) output = stderrOutput;

      const hasQuestions = /##\s*Questions/i.test(output);
      const questions = hasQuestions
        ? output.substring(output.search(/##\s*Questions/i))
        : undefined;

      // Resume verification: if we requested a resume but got a different thread_id,
      // the session was lost (Codex silently starts new threads for stale sessions)
      const resumeFailed = opts.resumeSessionId && threadId && threadId !== opts.resumeSessionId;

      const effectiveSessionId = threadId || opts.sessionId || crypto.randomUUID();

      resolve({
        success: code === 0 && !timedOut && !resumeFailed,
        output: resumeFailed
          ? `[RESUME FAILED: expected session ${opts.resumeSessionId}, got ${threadId}] ${output}`
          : output,
        sessionId: effectiveSessionId,
        hasQuestions,
        questions,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: err.message,
        sessionId: threadId || opts.sessionId,
      });
    });
  });
}
