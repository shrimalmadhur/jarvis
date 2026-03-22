import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { maskToken, testTelegramNotification } from "@/lib/notifications/telegram";
import { ensurePollerRunning } from "@/lib/issues/poller-manager";

const CHANNEL = "telegram-issues";

export async function GET() {
  try {
    const [config] = await db
      .select()
      .from(notificationConfigs)
      .where(eq(notificationConfigs.channel, CHANNEL))
      .limit(1);

    if (!config) {
      return NextResponse.json({ configured: false });
    }

    const cfg = config.config as Record<string, string>;
    return NextResponse.json({
      configured: true,
      enabled: config.enabled,
      botToken: cfg.bot_token ? maskToken(cfg.bot_token) : null,
      chatId: cfg.chat_id || null,
    });
  } catch (error) {
    console.error("Error loading telegram config:", error);
    return NextResponse.json({ error: "Failed to load config" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { botToken, chatId, test } = body;

    if (!botToken || !chatId) {
      return NextResponse.json(
        { error: "botToken and chatId are required" },
        { status: 400 }
      );
    }

    // Validate bot token format to prevent URL manipulation
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken)) {
      return NextResponse.json(
        { error: "Invalid bot token format" },
        { status: 400 }
      );
    }

    // Test connection if requested
    if (test) {
      const result = await testTelegramNotification(botToken, chatId);
      if (!result.success) {
        return NextResponse.json(
          { error: `Connection test failed: ${result.error}` },
          { status: 400 }
        );
      }
    }

    // Upsert config
    const [existing] = await db
      .select()
      .from(notificationConfigs)
      .where(eq(notificationConfigs.channel, CHANNEL))
      .limit(1);

    if (existing) {
      await db
        .update(notificationConfigs)
        .set({
          enabled: true,
          config: { bot_token: botToken, chat_id: chatId },
          updatedAt: new Date(),
        })
        .where(eq(notificationConfigs.id, existing.id));
    } else {
      await db.insert(notificationConfigs).values({
        channel: CHANNEL,
        enabled: true,
        config: { bot_token: botToken, chat_id: chatId },
      });
    }

    // Start poller now that config is available
    ensurePollerRunning();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving telegram config:", error);
    return NextResponse.json({ error: "Failed to save config" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await db
      .delete(notificationConfigs)
      .where(eq(notificationConfigs.channel, CHANNEL));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting telegram config:", error);
    return NextResponse.json({ error: "Failed to delete config" }, { status: 500 });
  }
}
