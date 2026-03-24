import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { maskToken } from "@/lib/notifications/telegram";
import { withErrorHandler } from "@/lib/api/utils";

// GET - retrieve current Telegram config (token masked)
export const GET = withErrorHandler(async () => {
  const rows = await db
    .select()
    .from(notificationConfigs)
    .where(eq(notificationConfigs.channel, "telegram"))
    .limit(1);

  const config = rows[0];

  if (!config) {
    return NextResponse.json({
      configured: false,
      enabled: false,
      botToken: "",
      chatId: "",
      source: process.env.TELEGRAM_BOT_TOKEN ? "env" : "none",
    });
  }

  const cfg = config.config as Record<string, string>;
  return NextResponse.json({
    configured: true,
    enabled: config.enabled,
    botToken: cfg.bot_token ? maskToken(cfg.bot_token) : "",
    chatId: cfg.chat_id || "",
    source: "db",
  });
});

// POST - save or update Telegram config
export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const { botToken, chatId, enabled } = body;

  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "Bot token and chat ID are required" },
      { status: 400 }
    );
  }

  // Check if a telegram row already exists
  const rows = await db
    .select()
    .from(notificationConfigs)
    .where(eq(notificationConfigs.channel, "telegram"))
    .limit(1);

  const existing = rows[0];

  if (existing) {
    const [updated] = await db
      .update(notificationConfigs)
      .set({
        enabled: enabled ?? true,
        config: { bot_token: botToken, chat_id: chatId },
        updatedAt: new Date(),
      })
      .where(eq(notificationConfigs.id, existing.id))
      .returning();
    return NextResponse.json({ success: true, id: updated.id });
  } else {
    const [created] = await db
      .insert(notificationConfigs)
      .values({
        channel: "telegram",
        enabled: enabled ?? true,
        config: { bot_token: botToken, chat_id: chatId },
      })
      .returning();
    return NextResponse.json({ success: true, id: created.id });
  }
});

// DELETE - remove DB config (falls back to env vars)
export const DELETE = withErrorHandler(async () => {
  await db
    .delete(notificationConfigs)
    .where(eq(notificationConfigs.channel, "telegram"));
  return NextResponse.json({ success: true });
});
