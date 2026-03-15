import { spawn, type ChildProcess } from "node:child_process";

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let activeProcesses = 0;
const MAX_CONCURRENT = 3;

/**
 * POST /api/claude/prompt
 *
 * Spawns `claude -p` CLI to generate a response, streamed back via SSE.
 * Requires JARVIS_PASSWORD or JARVIS_API_SECRET if configured.
 * Body: { prompt: string, systemPrompt?: string, model?: string }
 */
export async function POST(request: Request) {
  // Auth gate: require password/secret if configured
  const password = process.env.JARVIS_PASSWORD;
  const apiSecret = process.env.JARVIS_API_SECRET;
  if (password || apiSecret) {
    const authHeader = request.headers.get("authorization");
    const cookieHeader = request.headers.get("cookie");
    const hasValidBearer = authHeader && apiSecret && authHeader === `Bearer ${apiSecret}`;
    const hasValidCookie = cookieHeader && password && cookieHeader.includes(`jarvis-auth=${password}`);
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

  const { prompt, systemPrompt, model } = await request.json();

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

  let proc: ChildProcess | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      activeProcesses++;
      const encoder = new TextEncoder();

      proc = spawn("claude", args, {
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      // Timeout to kill hung processes
      timeout = setTimeout(() => {
        proc?.kill("SIGTERM");
      }, TIMEOUT_MS);

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
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "text", text: block.text })}\n\n`)
                    );
                  }
                }
              } else if (typeof msg.content === "string" && msg.content) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "text", text: msg.content })}\n\n`)
                );
              }
            }

            if (event.type === "result" && event.result) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "result", text: event.result })}\n\n`)
              );
            }
          } catch {
            // Not valid JSON yet, skip
          }
        }
      });

      proc.stderr!.on("data", () => {
        // Log server-side only, don't forward to client
      });

      proc.on("close", (code: number | null) => {
        if (timeout) clearTimeout(timeout);
        activeProcesses--;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done", code })}\n\n`)
        );
        controller.close();
      });

      proc.on("error", (err: Error) => {
        if (timeout) clearTimeout(timeout);
        activeProcesses--;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`)
        );
        controller.close();
      });
    },
    cancel() {
      // Kill child process when client disconnects
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
