import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationConfigs, agents } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { maskToken } from "@/lib/notifications/telegram";
import { withErrorHandler } from "@/lib/api/utils";

export const GET = withErrorHandler(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const excludeAgentId = searchParams.get("exclude");

  // Fetch all notification configs (table is small)
  const allConfigs = await db.select().from(notificationConfigs);

  // Filter to telegram channels only
  const telegramConfigs = allConfigs.filter((c) =>
    c.channel.startsWith("telegram")
  );

  // Exclude current agent's own config by channel string
  const excludeChannel = excludeAgentId
    ? `telegram-agent:${excludeAgentId}`
    : null;
  const filtered = telegramConfigs.filter(
    (c) => c.channel !== excludeChannel
  );

  // Collect agent IDs from telegram-agent:* channels for name resolution
  const agentIds = filtered
    .filter((c) => c.channel.startsWith("telegram-agent:"))
    .map((c) => c.channel.replace("telegram-agent:", ""));

  // Batch-query agent names (handles deleted agents gracefully)
  let agentMap: Record<string, string> = {};
  if (agentIds.length > 0) {
    const agentRows = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(inArray(agents.id, agentIds));
    agentMap = Object.fromEntries(agentRows.map((a) => [a.id, a.name]));
  }

  // Build response, deduplicating by (bot_token, chat_id) pair
  const seen = new Set<string>();
  const bots: Array<{
    id: string;
    maskedToken: string;
    botName: string;
    chatId: string;
    source: string;
  }> = [];

  for (const c of filtered) {
    const cfg = c.config as Record<string, string>;
    if (!cfg.bot_token || !cfg.chat_id) continue; // skip incomplete configs

    // Resolve human-readable source label
    let source: string;
    if (c.channel === "telegram") {
      source = "Global notifications";
    } else if (c.channel === "telegram-issues") {
      source = "Issues";
    } else if (c.channel.startsWith("telegram-agent:")) {
      const aid = c.channel.replace("telegram-agent:", "");
      const name = agentMap[aid];
      if (!name) continue; // orphaned config (agent deleted) — skip
      source = `Agent: ${name}`;
    } else {
      source = c.channel;
    }

    // Deduplicate by raw (bot_token, chat_id) pair
    const key = `${cfg.bot_token}:${cfg.chat_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    bots.push({
      id: c.id,
      maskedToken: maskToken(cfg.bot_token),
      botName: cfg.bot_name || "",
      chatId: cfg.chat_id,
      source,
    });
  }

  return NextResponse.json({ bots });
});
