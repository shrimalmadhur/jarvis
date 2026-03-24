import { NextResponse } from "next/server";
import { testTelegramNotification } from "@/lib/notifications/telegram";
import { withErrorHandler } from "@/lib/api/utils";

export const POST = withErrorHandler(async (request: Request) => {
  const { botToken, chatId } = await request.json();

  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "Bot token and chat ID are required" },
      { status: 400 }
    );
  }

  const result = await testTelegramNotification(botToken, chatId);
  return NextResponse.json(result);
});
