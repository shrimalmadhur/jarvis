import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/core";
import { withErrorHandler } from "@/lib/api/utils";

export const POST = withErrorHandler(async (request) => {
  const body = await request.json();
  const { conversationId, message } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json(
      { error: "Message is required" },
      { status: 400 }
    );
  }

  const response = await runAgent({
    conversationId,
    message,
  });

  return NextResponse.json(response);
});
