import https from "node:https";
import nodeFetch from "node-fetch";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Reuse the IPv4 agent pattern from src/lib/db/index.ts
const ipv4Agent = new https.Agent({ family: 4 });

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Resolve Telegram config: DB override takes precedence over env vars.
 * Returns null if not configured or explicitly disabled.
 */
async function getTelegramConfig(): Promise<TelegramConfig | null> {
  try {
    const rows = await db
      .select()
      .from(notificationConfigs)
      .where(eq(notificationConfigs.channel, "telegram"))
      .limit(1);

    const dbConfig = rows[0];

    if (dbConfig && dbConfig.enabled) {
      const cfg = dbConfig.config as Record<string, string>;
      if (cfg.bot_token && cfg.chat_id) {
        return { botToken: cfg.bot_token, chatId: cfg.chat_id };
      }
    }

    // If DB row exists but is disabled, return null (explicitly disabled)
    if (dbConfig && !dbConfig.enabled) {
      return null;
    }
  } catch (error) {
    console.error("Failed to load Telegram config from DB:", error);
  }

  // Fall back to environment variables
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    return { botToken, chatId };
  }

  return null;
}

/**
 * Send a Telegram message via the Bot API.
 */
async function sendTelegramMessage(
  config: TelegramConfig,
  text: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  const response = await nodeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: "Markdown",
    }),
    agent: ipv4Agent,
  } as never);

  if (!response.ok) {
    const body = await response.text();
    console.error("Telegram API error:", response.status, body);
  }
}

/**
 * Escape Markdown v1 special characters for Telegram.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Send a conversation completion notification to Telegram.
 * Fire-and-forget: catches all errors internally, returns void.
 * Optionally includes a change summary (e.g. git diff stats from a hook).
 */
export function notifyConversationComplete(
  title: string,
  assistantMessage: string,
  conversationId: string,
  changes?: string
): void {
  // Intentionally not awaited -- fire-and-forget
  (async () => {
    try {
      const config = await getTelegramConfig();
      if (!config) return;

      // Telegram limit is 4096 chars; reserve space for header + changes
      const changesBlock = changes ? `\n\n\`\`\`\n${changes}\n\`\`\`` : "";
      const overhead = 200 + changesBlock.length;
      const maxLen = Math.max(500, 3800 - overhead);
      const truncated =
        assistantMessage.length > maxLen
          ? assistantMessage.substring(0, maxLen) + "..."
          : assistantMessage;

      const parts = [
        `*Jarvis* \u2014 conversation complete`,
        ``,
        `*${escapeMarkdown(title)}*`,
        ``,
        escapeMarkdown(truncated),
      ];

      if (changesBlock) {
        parts.push(changesBlock);
      }

      await sendTelegramMessage(config, parts.join("\n"));
    } catch (error) {
      console.error("Telegram notification error:", error);
    }
  })();
}

/**
 * Test the Telegram connection. Awaitable, returns success/error.
 */
export async function testTelegramNotification(
  botToken: string,
  chatId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await sendTelegramMessage(
      { botToken, chatId },
      "Jarvis test notification \u2014 connection successful."
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
