import { NextResponse } from "next/server";
import { notifyConversationComplete } from "@/lib/notifications/telegram";
import { withErrorHandler } from "@/lib/api/utils";

// POST - send a Telegram notification from an external caller (e.g. Claude Code Stop hook)
export const POST = withErrorHandler(async (request: Request) => {
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
});
