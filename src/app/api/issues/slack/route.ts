import { NextResponse } from "next/server";
import {
  isValidSlackAppToken,
  isValidSlackBotToken,
  maskSlackToken,
  testSlackConnection,
} from "@/lib/notifications/slack";
import { ensureSlackIssuesSocketRunning, stopSlackIssuesSocket, getSlackEventDiagnostics, isSlackSocketConnected } from "@/lib/issues/slack-socket";
import { upsertNotificationConfig, getNotificationConfig, deleteNotificationConfig } from "@/lib/db/notification-config";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

const CHANNEL = "slack-issues";

export const GET = withErrorHandler(async () => {
  const config = getNotificationConfig(CHANNEL);

  if (!config) {
    return NextResponse.json({ configured: false });
  }

  const cfg = config.config as Record<string, string>;
  const diagnostics = getSlackEventDiagnostics();
  return NextResponse.json({
    configured: true,
    enabled: config.enabled,
    botToken: cfg.bot_token ? maskSlackToken(cfg.bot_token) : null,
    appToken: cfg.app_token ? maskSlackToken(cfg.app_token) : null,
    channelId: cfg.channel_id || null,
    diagnostics: {
      socketConnected: isSlackSocketConnected(),
      appMentionReceived: diagnostics.appMentionSeen,
      messageReceived: diagnostics.messageSeen,
      threadRepliesMayNotWork: diagnostics.threadRepliesMayNotWork,
      uptimeMs: diagnostics.uptimeMs,
    },
  });
});

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const { botToken, appToken, channelId, test } = body;

  if (!botToken || !appToken) {
    return NextResponse.json(
      { error: "botToken and appToken are required" },
      { status: 400 }
    );
  }

  if (!isValidSlackBotToken(botToken)) {
    return NextResponse.json({ error: "Invalid Slack bot token format" }, { status: 400 });
  }

  if (!isValidSlackAppToken(appToken)) {
    return NextResponse.json({ error: "Invalid Slack app token format" }, { status: 400 });
  }

  let warnings: string[] = [];
  if (test) {
    const result = await testSlackConnection(botToken, appToken, channelId || undefined);
    warnings = result.warnings;
  }

  const config: Record<string, string> = {
    bot_token: botToken,
    app_token: appToken,
    ...(channelId ? { channel_id: channelId } : {}),
  };

  upsertNotificationConfig(CHANNEL, config);

  ensureSlackIssuesSocketRunning();

  return NextResponse.json({ success: true, warnings });
});

export const DELETE = withErrorHandler(async () => {
  deleteNotificationConfig(CHANNEL);
  stopSlackIssuesSocket();
  return NextResponse.json({ success: true });
});
