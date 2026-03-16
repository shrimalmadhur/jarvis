import { subscribeToRun, isRunActive } from "@/lib/runner/run-events";

export const dynamic = "force-dynamic";

// Slightly longer than the 10-minute agent timeout
const STREAM_TIMEOUT_MS = 11 * 60 * 1000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  if (!isRunActive(agentId)) {
    return new Response(JSON.stringify({ error: "No active run" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const closeStream = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const unsubscribe = subscribeToRun(agentId, (event) => {
        if (closed) return;
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));

        // Close the stream after the complete event
        if (event.type === "complete") {
          setTimeout(closeStream, 100);
        }
      });

      if (!unsubscribe) {
        // Run ended between the check and subscribe
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "complete", timestamp: Date.now(), data: { success: false, error: "Run already finished" } })}\n\n`
          )
        );
        controller.close();
        return;
      }

      // Safety timeout: close stream if complete event is never received
      const timeout = setTimeout(closeStream, STREAM_TIMEOUT_MS);

      // Clean up on client disconnect
      _request.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        closeStream();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
