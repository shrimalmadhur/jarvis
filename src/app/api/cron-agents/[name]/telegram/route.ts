import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.substring(0, 4) + "****" + token.substring(token.length - 4);
}

function channelKey(agentName: string) {
  return `telegram-agent:${agentName}`;
}

// GET - retrieve per-agent Telegram config (token masked)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const rows = await db
      .select()
      .from(notificationConfigs)
      .where(eq(notificationConfigs.channel, channelKey(name)))
      .limit(1);

    const config = rows[0];
    if (!config) {
      return NextResponse.json({
        configured: false,
        enabled: false,
        botToken: "",
        chatId: "",
        botName: "",
      });
    }

    const cfg = config.config as Record<string, string>;
    return NextResponse.json({
      configured: true,
      enabled: config.enabled,
      botToken: cfg.bot_token ? maskToken(cfg.bot_token) : "",
      chatId: cfg.chat_id || "",
      botName: cfg.bot_name || "",
    });
  } catch (error) {
    console.error("Error fetching agent Telegram config:", error);
    return NextResponse.json(
      { error: "Failed to fetch config" },
      { status: 500 }
    );
  }
}

// POST - save or update per-agent Telegram config
export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const body = await request.json();
    const { botToken, chatId, botName, enabled } = body;

    if (!botToken || !chatId) {
      return NextResponse.json(
        { error: "Bot token and chat ID are required" },
        { status: 400 }
      );
    }

    const channel = channelKey(name);
    const configData = {
      bot_token: botToken,
      chat_id: chatId,
      bot_name: botName || "",
    };

    const rows = await db
      .select()
      .from(notificationConfigs)
      .where(eq(notificationConfigs.channel, channel))
      .limit(1);

    const existing = rows[0];

    if (existing) {
      const [updated] = await db
        .update(notificationConfigs)
        .set({
          enabled: enabled ?? true,
          config: configData,
          updatedAt: new Date(),
        })
        .where(eq(notificationConfigs.id, existing.id))
        .returning();
      return NextResponse.json({ success: true, id: updated.id });
    } else {
      const [created] = await db
        .insert(notificationConfigs)
        .values({
          channel,
          enabled: enabled ?? true,
          config: configData,
        })
        .returning();
      return NextResponse.json({ success: true, id: created.id });
    }
  } catch (error) {
    console.error("Error saving agent Telegram config:", error);
    return NextResponse.json(
      { error: "Failed to save config" },
      { status: 500 }
    );
  }
}

// DELETE - remove per-agent Telegram config
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    await db
      .delete(notificationConfigs)
      .where(eq(notificationConfigs.channel, channelKey(name)));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting agent Telegram config:", error);
    return NextResponse.json(
      { error: "Failed to delete config" },
      { status: 500 }
    );
  }
}
