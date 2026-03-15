import {
  sendTelegramMessage,
  markdownToTelegramHtml,
} from "@/lib/notifications/telegram";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { RunResult } from "./types";

/**
 * Look up per-agent Telegram config from the DB.
 * Tries agentId-based channel first (DB agents), falls back to agentName (filesystem agents).
 * Returns null if not configured or disabled.
 */
export async function getAgentTelegramConfig(
  agentName: string,
  agentId?: string
): Promise<{ botToken: string; chatId: string } | null> {
  try {
    // Try agentId-based channel first for DB agents
    if (agentId) {
      const idRows = await db
        .select()
        .from(notificationConfigs)
        .where(
          and(
            eq(notificationConfigs.channel, `telegram-agent:${agentId}`),
            eq(notificationConfigs.enabled, true)
          )
        )
        .limit(1);

      const idConfig = idRows[0];
      if (idConfig) {
        const cfg = idConfig.config as Record<string, string>;
        if (cfg.bot_token && cfg.chat_id) {
          return { botToken: cfg.bot_token, chatId: cfg.chat_id };
        }
      }
    }

    // Fall back to agentName-based channel
    const rows = await db
      .select()
      .from(notificationConfigs)
      .where(
        and(
          eq(notificationConfigs.channel, `telegram-agent:${agentName}`),
          eq(notificationConfigs.enabled, true)
        )
      )
      .limit(1);

    const config = rows[0];
    if (config) {
      const cfg = config.config as Record<string, string>;
      if (cfg.bot_token && cfg.chat_id) {
        return { botToken: cfg.bot_token, chatId: cfg.chat_id };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Send an agent's run result to its dedicated Telegram bot.
 */
export async function sendAgentResult(
  telegramConfig: { botToken: string; chatId: string },
  agentName: string,
  result: RunResult
): Promise<void> {
  const maxLen = 3800;
  const trimmed =
    result.output.length > maxLen
      ? result.output.substring(0, maxLen) + "..."
      : result.output;

  const outputHtml = markdownToTelegramHtml(trimmed);

  const meta = [
    `Model: ${result.model}`,
    `Tokens: ${result.tokensUsed.prompt + result.tokensUsed.completion}`,
    `Time: ${(result.durationMs / 1000).toFixed(1)}s`,
  ].join(" | ");

  const message = [outputHtml, "", `<i>${meta}</i>`].join("\n");

  await sendTelegramMessage(telegramConfig, message);
}
