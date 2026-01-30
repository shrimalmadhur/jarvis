import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/core";

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    console.error("Agent chat error:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}
