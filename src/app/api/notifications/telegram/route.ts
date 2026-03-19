import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { maskToken } from "@/lib/notifications/telegram";

// GET - retrieve current Telegram config (token masked)
export async function GET() {
  try {
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
  } catch (error) {
    console.error("Error fetching Telegram config:", error);
    return NextResponse.json(
      { error: "Failed to fetch config" },
      { status: 500 }
    );
  }
}

// POST - save or update Telegram config
export async function POST(request: Request) {
  try {
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
  } catch (error) {
    console.error("Error saving Telegram config:", error);
    return NextResponse.json(
      { error: "Failed to save config" },
      { status: 500 }
    );
  }
}

// DELETE - remove DB config (falls back to env vars)
export async function DELETE() {
  try {
    await db
      .delete(notificationConfigs)
      .where(eq(notificationConfigs.channel, "telegram"));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting Telegram config:", error);
    return NextResponse.json(
      { error: "Failed to delete config" },
      { status: 500 }
    );
  }
}
