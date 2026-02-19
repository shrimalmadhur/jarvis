import { NextResponse } from "next/server";
import { testTelegramNotification } from "@/lib/notifications/telegram";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// POST - test per-agent Telegram connection
// Supports both direct token/chatId and reading from DB (useStored: true)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const body = await request.json();
    let { botToken, chatId } = body;

    // If useStored flag or token looks masked, read from DB
    if (body.useStored || (botToken && botToken.includes("****"))) {
      const rows = await db
        .select()
        .from(notificationConfigs)
        .where(eq(notificationConfigs.channel, `telegram-agent:${name}`))
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
  } catch (error) {
    console.error("Error testing agent Telegram:", error);
    return NextResponse.json(
      { success: false, error: "Test failed" },
      { status: 500 }
    );
  }
}
