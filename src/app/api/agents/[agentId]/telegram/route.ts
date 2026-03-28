import { NextResponse } from "next/server";
import { maskToken } from "@/lib/notifications/telegram";
import { upsertNotificationConfig, getNotificationConfig, deleteNotificationConfig } from "@/lib/db/notification-config";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

function channelKey(agentId: string) {
  return `telegram-agent:${agentId}`;
}

export const GET = withErrorHandler(async (_request, { params }) => {
  const { agentId } = await params;

  const config = getNotificationConfig(channelKey(agentId));
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
});

export const POST = withErrorHandler(async (request, { params }) => {
  const { agentId } = await params;

  const body = await request.json();
  const { botToken, chatId, botName, enabled } = body;

  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "Bot token and chat ID are required" },
      { status: 400 }
    );
  }

  const id = upsertNotificationConfig(
    channelKey(agentId),
    { bot_token: botToken, chat_id: chatId, bot_name: botName || "" },
    enabled ?? true
  );

  return NextResponse.json({ success: true, id });
});

export const DELETE = withErrorHandler(async (_request, { params }) => {
  const { agentId } = await params;
  deleteNotificationConfig(channelKey(agentId));
  return NextResponse.json({ success: true });
});
