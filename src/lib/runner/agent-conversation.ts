import { spawn } from "node:child_process";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { resolveCodexPath } from "@/lib/harness/resolve-codex-path";
import { buildCodexEnv } from "@/lib/harness/codex-harness";
import type { HarnessType } from "@/lib/harness/types";
import { buildChildEnv } from "./agent-memory";

// ── Constants ────────────────────────────────────────────────

const RESUME_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per reply

// ── Resume a session (Claude or Codex) ──────────────────────

/**
 * Resume an existing CLI session with a new user message.
 * Spawns the appropriate CLI (claude or codex) in resume mode.
 */
export async function resumeSession(
  sessionId: string,
  workspaceDir: string,
  userMessage: string,
  opts?: { envVars?: Record<string, string>; harness?: HarnessType },
): Promise<string> {
  const harness = opts?.harness || "claude";

  if (harness === "codex") {
    const codexEnv = buildCodexEnv(opts?.envVars);
    return resumeCodexSession(sessionId, workspaceDir, userMessage, codexEnv);
  }
  const childEnv = buildChildEnv(opts?.envVars);
  return resumeClaudeSession(sessionId, workspaceDir, userMessage, childEnv);
}

function resumeClaudeSession(
  sessionId: string,
  workspaceDir: string,
  userMessage: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--resume", sessionId,
  ];

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(resolveClaudePath(), args, { cwd: workspaceDir, env });

    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill("SIGTERM"); }, RESUME_TIMEOUT_MS);
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };

    proc.stdin!.write(userMessage);
    proc.stdin!.end();

    let buffer = "";
    let resultText = "";
    const assistantBlocks: string[] = [];
    let stderrOutput = "";

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.length > 5000) stderrOutput = stderrOutput.slice(-5000);
    });

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
          if (event.type === "result" && event.result) resultText = event.result;
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) assistantBlocks.push(block.text);
            }
          }
        } catch { /* skip non-JSON */ }
      }
    });

    proc.on("close", (code) => {
      settle(() => {
        if (timedOut) { reject(new Error("Claude session timed out")); return; }
        const output = resultText || assistantBlocks.join("\n\n");
        if (code === 0) resolve(output);
        else reject(new Error(`Claude CLI failed: ${stderrOutput || `exit code ${code}`}`));
      });
    });

    proc.on("error", (err) => settle(() => reject(err)));
  });
}

function resumeCodexSession(
  sessionId: string,
  workspaceDir: string,
  userMessage: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const args = [
    "exec", "resume", sessionId,
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd", workspaceDir,
    "--skip-git-repo-check",
    "-",
  ];

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(resolveCodexPath(), args, { cwd: workspaceDir, env });

    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill("SIGTERM"); }, RESUME_TIMEOUT_MS);
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };

    proc.stdin!.write(userMessage);
    proc.stdin!.end();

    let buffer = "";
    const completedItems: string[] = [];
    let stderrOutput = "";

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.length > 5000) stderrOutput = stderrOutput.slice(-5000);
    });

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
          if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item?.text) {
            completedItems.push(event.item.text);
          }
        } catch { /* skip non-JSON */ }
      }
    });

    proc.on("close", (code) => {
      settle(() => {
        if (timedOut) { reject(new Error("Codex session timed out")); return; }
        const output = completedItems.join("\n\n");
        if (code === 0) resolve(output);
        else reject(new Error(`Codex CLI failed: ${stderrOutput || `exit code ${code}`}`));
      });
    });

    proc.on("error", (err) => settle(() => reject(err)));
  });
}
