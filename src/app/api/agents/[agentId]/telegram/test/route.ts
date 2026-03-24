import { NextResponse } from "next/server";
import { testTelegramNotification } from "@/lib/notifications/telegram";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api/utils";

export const POST = withErrorHandler(async (request, { params }) => {
  const { agentId } = await params;

  const body = await request.json();
  let { botToken, chatId } = body;

  if (body.useStored || (botToken && botToken.includes("****"))) {
    const rows = await db
      .select()
      .from(notificationConfigs)
      .where(eq(notificationConfigs.channel, `telegram-agent:${agentId}`))
      .limit(1);

    const config = rows[0];
    if (!config) {
      return NextResponse.json(
        { success: false, error: "No stored config found" },
        { status: 404 }
      );
    }

    const cfg = config.config as Record<string, string>;
    botToken = cfg.bot_token;
    chatId = cfg.chat_id;
  }

  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "Bot token and chat ID are required" },
      { status: 400 }
    );
  }

  const result = await testTelegramNotification(botToken, chatId);
  return NextResponse.json(result);
});
