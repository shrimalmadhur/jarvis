import { spawn, type ChildProcess } from "node:child_process";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { resolveCodexPath } from "@/lib/harness/resolve-codex-path";
import { buildCodexEnv } from "@/lib/harness/codex-harness";
import { buildClaudeEnv } from "@/lib/harness/claude-harness";
import { getDefaultHarness } from "@/lib/harness/run-phase";
import type { HarnessType } from "@/lib/harness/types";

export const runtime = "nodejs";

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let activeProcesses = 0;
const MAX_CONCURRENT = 3;

/**
 * POST /api/claude/prompt
 *
 * Spawns a CLI (claude or codex) to generate a response, streamed back via SSE.
 * Requires DOBBY_PASSWORD or DOBBY_API_SECRET if configured.
 * Body: { prompt: string, systemPrompt?: string, model?: string, harness?: "claude" | "codex" }
 */
export async function POST(request: Request) {
  // Auth gate: require password/secret if configured
  const password = process.env.DOBBY_PASSWORD;
  const apiSecret = process.env.DOBBY_API_SECRET;
  if (password || apiSecret) {
    const authHeader = request.headers.get("authorization");
    const cookieHeader = request.headers.get("cookie");
    const hasValidBearer = authHeader && apiSecret && authHeader === `Bearer ${apiSecret}`;
    const hasValidCookie = cookieHeader && password && cookieHeader.includes(`dobby-auth=${password}`);
    if (!hasValidBearer && !hasValidCookie) {
      // Also accept password in request body or referer-based trust for same-origin
      const origin = request.headers.get("origin") || request.headers.get("referer");
      const host = request.headers.get("host");
      const isSameOrigin = origin && host && origin.includes(host);
      if (!isSameOrigin) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

  const { prompt, systemPrompt, model, harness: requestedHarness } = await request.json();

  if (!prompt) {
    return new Response(JSON.stringify({ error: "Prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Concurrency limit
  if (activeProcesses >= MAX_CONCURRENT) {
    return new Response(JSON.stringify({ error: "Too many concurrent requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  const harness: HarnessType = requestedHarness === "codex" || requestedHarness === "claude"
    ? requestedHarness
    : getDefaultHarness();

  let proc: ChildProcess | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      activeProcesses++;
      let cleaned = false;
      const encoder = new TextEncoder();

      const safeEnqueue = (data: Uint8Array) => {
        if (!cleaned) controller.enqueue(data);
      };

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (timeout) clearTimeout(timeout);
        activeProcesses--;
        controller.close();
      };

      if (harness === "codex") {
        // ── Codex CLI ──
        const args = [
          "exec", "--json",
          "--dangerously-bypass-approvals-and-sandbox",
          "--skip-git-repo-check",
          "--ephemeral",
          "-",
        ];
        if (model) args.splice(2, 0, "-m", model);

        // Codex has no --append-system-prompt: prepend to prompt
        let fullPrompt = prompt;
        if (systemPrompt) {
          fullPrompt = `## System Instructions\n${systemPrompt}\n\n## Task\n${prompt}`;
        }

        proc = spawn(resolveCodexPath(), args, {
          env: buildCodexEnv(),
        });

        timeout = setTimeout(() => { proc?.kill("SIGTERM"); }, TIMEOUT_MS);

        proc.stdin!.write(fullPrompt);
        proc.stdin!.end();

        let buffer = "";

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
                safeEnqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "result", text: event.item.text })}\n\n`)
                );
              }
            } catch { /* skip non-JSON */ }
          }
        });

        proc.stderr!.on("data", () => { /* log server-side only */ });

        proc.on("close", (code: number | null) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", code })}\n\n`));
          cleanup();
        });

        proc.on("error", (err: Error) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`));
          cleanup();
        });
      } else {
        // ── Claude CLI ──
        const args = [
          "-p",
          "--verbose",
          "--output-format", "stream-json",
          "--dangerously-skip-permissions",
        ];

        if (systemPrompt) {
          args.push("--append-system-prompt", systemPrompt);
        }

        if (model) {
          args.push("--model", model);
        }

        const claudePath = resolveClaudePath();
        proc = spawn(claudePath, args, {
          env: buildClaudeEnv(),
        });

        timeout = setTimeout(() => { proc?.kill("SIGTERM"); }, TIMEOUT_MS);

        proc.stdin!.write(prompt);
        proc.stdin!.end();

        let buffer = "";

        proc.stdout!.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed);

              if (event.type === "assistant" && event.message) {
                const msg = event.message;
                if (msg.content && Array.isArray(msg.content)) {
                  for (const block of msg.content) {
                    if (block.type === "text" && block.text) {
                      safeEnqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: "text", text: block.text })}\n\n`)
                      );
                    }
                  }
                } else if (typeof msg.content === "string" && msg.content) {
                  safeEnqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "text", text: msg.content })}\n\n`)
                  );
                }
              }

              if (event.type === "result" && event.result) {
                safeEnqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "result", text: event.result })}\n\n`)
                );
              }
            } catch { /* skip non-JSON */ }
          }
        });

        proc.stderr!.on("data", () => { /* log server-side only */ });

        proc.on("close", (code: number | null) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", code })}\n\n`));
          cleanup();
        });

        proc.on("error", (err: Error) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`));
          cleanup();
        });
      }
    },
    cancel() {
      if (timeout) clearTimeout(timeout);
      proc?.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
