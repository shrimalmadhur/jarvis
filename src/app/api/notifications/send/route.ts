import { NextResponse } from "next/server";
import { notifyConversationComplete } from "@/lib/notifications/telegram";

// POST - send a Telegram notification from an external caller (e.g. Claude Code Stop hook)
export async function POST(request: Request) {
  try {
    const { title, message, changes } = await request.json();

    if (!title && !message) {
      return NextResponse.json(
        { error: "title or message is required" },
        { status: 400 }
      );
    }

    notifyConversationComplete(
      title || "Agent update",
      message || "Completed",
      "",
      changes || undefined
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending notification:", error);
    return NextResponse.json(
      { error: "Failed to send notification" },
      { status: 500 }
    );
  }
}
