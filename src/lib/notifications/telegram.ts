import https from "node:https";
import nodeFetch from "node-fetch";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Reuse the IPv4 agent pattern from src/lib/db/index.ts
const ipv4Agent = new https.Agent({ family: 4 });

/** Telegram's hard limit for message length */
export const TELEGRAM_MAX_MSG_LEN = 4096;

/** Safe limit with overhead budget for formatting/metadata */
export const TELEGRAM_SAFE_MSG_LEN = 3800;

/**
 * Mask a secret token for display: show first 4 and last 4 chars.
 */
export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.substring(0, 4) + "****" + token.substring(token.length - 4);
}

export interface TelegramConfig {
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
 * Send a Telegram message via the Bot API using HTML parse mode.
 */
export async function sendTelegramMessage(
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
      parse_mode: "HTML",
    }),
    agent: ipv4Agent,
  } as never);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API error: ${response.status} ${body}`);
  }
}

/**
 * Send a Telegram message and return the message_id from the response.
 * Used by the issues Q&A flow to track reply_to_message_id.
 */
export async function sendTelegramMessageWithId(
  config: TelegramConfig,
  text: string
): Promise<number> {
  const truncated = text.length > TELEGRAM_MAX_MSG_LEN ? text.substring(0, TELEGRAM_MAX_MSG_LEN - 3) + "..." : text;
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  const response = await nodeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: truncated,
      parse_mode: "HTML",
    }),
    agent: ipv4Agent,
  } as never);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API error: ${response.status} ${body}`);
  }

  const result = await response.json() as { ok: boolean; result: { message_id: number } };
  return result.result.message_id;
}

/**
 * Escape HTML special characters for Telegram.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert markdown to Telegram-compatible HTML.
 * Telegram supports: <b>, <i>, <code>, <pre>, <a>, <s>, <u>, <blockquote>
 *
 * Strategy: extract code blocks/inline first (with placeholders),
 * HTML-escape everything, then apply markdown→HTML conversions,
 * then restore code blocks.
 */
export function markdownToTelegramHtml(text: string): string {
  // 1. Extract code blocks and inline code into placeholders
  const codeSlots: string[] = [];
  let html = text;

  // Fenced code blocks → placeholder
  html = html.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_m, code: string) => {
    const i = codeSlots.length;
    codeSlots.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `\x00CODE${i}\x00`;
  });

  // Inline code → placeholder
  html = html.replace(/`(.+?)`/g, (_m, code: string) => {
    const i = codeSlots.length;
    codeSlots.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00CODE${i}\x00`;
  });

  // 2. HTML-escape the rest (safe because code is already extracted)
  html = escapeHtml(html);

  // 3. Convert markdown to HTML tags
  // Headings → bold
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Bold **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic *text* or _text_
  html = html.replace(/\*(.+?)\*/g, "<i>$1</i>");

  // Strikethrough ~~text~~
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links [text](url)
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Bullet lists: - or * at line start → bullet character
  html = html.replace(/^\s*[-*]\s+/gm, "\u2022 ");

  // Collapse 3+ newlines
  html = html.replace(/\n{3,}/g, "\n\n");

  // 4. Restore code blocks
  html = html.replace(/\x00CODE(\d+)\x00/g, (_m, i: string) => codeSlots[+i]);

  return html.trim();
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

      const changesBlock = changes
        ? `\n\n<pre>${escapeHtml(changes)}</pre>`
        : "";
      const overhead = 150 + changesBlock.length;
      const maxLen = Math.max(300, 3900 - overhead);

      // Truncate raw text first, then convert to HTML
      const trimmed =
        assistantMessage.length > maxLen
          ? assistantMessage.substring(0, maxLen) + "..."
          : assistantMessage;

      const messageHtml = markdownToTelegramHtml(trimmed);

      const parts = [
        `\u{1f916} <b>${escapeHtml(title)}</b>`,
        ``,
        messageHtml,
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
      "Dobby test notification \u2014 connection successful."
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
