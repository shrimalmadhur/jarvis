import { NextResponse } from "next/server";
import { validateBotToken, pollForChat, clearPendingUpdates } from "@/lib/telegram/setup";
import { withErrorHandler } from "@/lib/api/utils";

export const POST = withErrorHandler(async (request: Request) => {
  const { botToken, action } = await request.json();

  if (!botToken) {
    return NextResponse.json({ error: "Bot token is required" }, { status: 400 });
  }

  if (action === "validate") {
    const result = await validateBotToken(botToken);
    // Drain stale updates so polling only sees new messages
    if (result.valid) {
      await clearPendingUpdates(botToken);
    }
    return NextResponse.json(result);
  }

  if (action === "poll") {
    return NextResponse.json(await pollForChat(botToken));
  }

  return NextResponse.json(
    { error: 'Invalid action. Use "validate" or "poll".' },
    { status: 400 }
  );
});
