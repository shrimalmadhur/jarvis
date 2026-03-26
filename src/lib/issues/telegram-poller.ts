import nodeFetch from "node-fetch";
import { db } from "@/lib/db";
import { repositories, issues, issueMessages, notificationConfigs } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { sendTelegramMessage, sendTelegramReply, escapeHtml, markdownToTelegramHtml, TELEGRAM_SAFE_MSG_LEN } from "@/lib/notifications/telegram";
import { ipv4Agent } from "@/lib/telegram/api";
import { PHASE_STATUS_MAP } from "./types";
import type { TelegramUpdate, IssuesTelegramConfig } from "./types";
import { saveTelegramPhoto } from "./attachments";
import { resumeSession } from "@/lib/runner/agent-conversation";

/**
 * Load the dedicated issues Telegram bot config from notification_configs.
 * Channel: "telegram-issues"
 */
export async function getIssuesTelegramConfig(): Promise<IssuesTelegramConfig | null> {
  const rows = await db
    .select()
    .from(notificationConfigs)
    .where(eq(notificationConfigs.channel, "telegram-issues"))
    .limit(1);
  const cfg = rows[0];
  if (!cfg?.enabled) return null;
  const config = cfg.config as Record<string, string>;
  if (config.bot_token && config.chat_id) {
    return { botToken: config.bot_token, chatId: config.chat_id };
  }
  return null;
}

/**
 * Long-poll Telegram for updates. Returns updates and next offset.
 * Uses 30s timeout for long polling.
 */
export async function pollTelegramUpdates(
  botToken: string,
  offset: number
): Promise<{ updates: TelegramUpdate[]; nextOffset: number }> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
  const response = await nodeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offset,
      timeout: 30,
      allowed_updates: ["message"],
    }),
    agent: ipv4Agent,
    timeout: 35000,
  } as never);

  if (!response.ok) {
    throw new Error(`Telegram getUpdates error: ${response.status}`);
  }

  const data = await response.json() as { ok: boolean; result: TelegramUpdate[] };
  const updates = data.result || [];
  const nextOffset = updates.length > 0
    ? updates[updates.length - 1].update_id + 1
    : offset;

  return { updates, nextOffset };
}

/**
 * Parse a Telegram message for issue creation.
 * Format: /issue RepoName: description of the issue
 * Returns null if message doesn't match the format.
 */
export function parseIssueMessage(text: string): { repoName: string; description: string } | null {
  const match = text.match(/^\/issue\s+([^\s:]+)[:\s]+([\s\S]+)/);
  if (!match) return null;
  return {
    repoName: match[1].trim(),
    description: match[2].trim(),
  };
}

/**
 * Process a single Telegram update.
 * - New /issue message (text or photo+caption): create issue in DB
 * - Reply to a Claude question: store as user reply
 * Validates that the chat_id matches the configured issues chat.
 */
export async function processTelegramUpdate(
  update: TelegramUpdate,
  config: IssuesTelegramConfig
): Promise<void> {
  const msg = update.message;
  if (!msg) return;

  // Security: only accept messages from the configured chat
  if (String(msg.chat.id) !== config.chatId) return;

  // Accept text OR caption (photo messages use caption instead of text)
  const messageText = msg.text || msg.caption;

  // Check if this is a reply to a Claude question
  if (msg.reply_to_message) {
    const replyToMsgId = msg.reply_to_message.message_id;
    const [issueMsg] = await db
      .select()
      .from(issueMessages)
      .where(eq(issueMessages.telegramMessageId, replyToMsgId))
      .limit(1);

    if (issueMsg && issueMsg.direction === "from_claude") {
      // Store user reply — use messageText if available, or "[photo attached]" for photo-only replies
      await db.insert(issueMessages).values({
        issueId: issueMsg.issueId,
        direction: "from_user",
        message: messageText || "[photo attached]",
        telegramMessageId: msg.message_id,
      });

      // Download photos attached to reply (if any)
      if (msg.photo && msg.photo.length > 0) {
        const largestPhoto = msg.photo[msg.photo.length - 1];
        try {
          await saveTelegramPhoto(config.botToken, issueMsg.issueId, largestPhoto.file_id);
        } catch (err) {
          console.error(`[poller] Failed to download reply photo for issue ${issueMsg.issueId}:`, err);
        }
      }

      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueMsg.issueId))
        .limit(1);

      // If issue is waiting_for_input, update status back to the phase it was in
      if (issue?.status === "waiting_for_input") {
        const resumeStatus = PHASE_STATUS_MAP[issue.currentPhase] || "pending";
        await db.update(issues)
          .set({ status: resumeStatus, updatedAt: new Date() })
          .where(eq(issues.id, issue.id));
      }

      // If issue is completed, resume the Claude session to continue the conversation
      if (issue?.status === "completed" && messageText) {
        handleCompletedIssueReply(issue, messageText, msg.message_id, config).catch((err) => {
          console.error(`[poller] Failed to handle completed issue reply:`, err);
        });
      }
      return;
    }
  }

  // From here on, we need messageText for /issue command parsing
  if (!messageText) return;

  // Check if this is a new issue
  const parsed = parseIssueMessage(messageText);
  if (!parsed) return;

  // Look up repository (case-insensitive)
  const [repo] = await db
    .select()
    .from(repositories)
    .where(sql`lower(${repositories.name}) = lower(${parsed.repoName})`)
    .limit(1);

  if (!repo) {
    await sendTelegramMessage(config,
      `Repository "<b>${escapeHtml(parsed.repoName)}</b>" not found. ` +
      `Check the Issues tab in Dobby UI for available repos.`
    );
    return;
  }

  // Create the issue
  const title = parsed.description.split('\n')[0].substring(0, 100);
  const [newIssue] = await db.insert(issues).values({
    repositoryId: repo.id,
    title,
    description: parsed.description,
    telegramMessageId: msg.message_id,
    telegramChatId: String(msg.chat.id),
  }).returning();

  // Download and save attached photos (non-fatal on failure)
  if (msg.photo && msg.photo.length > 0) {
    const largestPhoto = msg.photo[msg.photo.length - 1];
    try {
      await saveTelegramPhoto(config.botToken, newIssue.id, largestPhoto.file_id);
    } catch (err) {
      console.error(`[poller] Failed to download photo for issue ${newIssue.id}:`, err);
    }
  }

  await sendTelegramMessage(config,
    `Issue created: <b>${escapeHtml(title)}</b>\n` +
    `Repository: ${escapeHtml(repo.name)}\n` +
    `ID: <code>${newIssue.id.substring(0, 8)}</code>`
  );
}

// ── Completed issue conversation ─────────────────────────────

// Concurrency guard — only one resume per issue at a time
const activeIssueResumes = new Set<string>();

/**
 * Handle a reply to a completed issue by resuming the Claude session.
 * The response is sent back as a threaded Telegram reply, and both
 * messages are stored in issueMessages for future reply matching.
 */
async function handleCompletedIssueReply(
  issue: typeof issues.$inferSelect,
  userText: string,
  userMessageId: number,
  config: IssuesTelegramConfig
) {
  if (activeIssueResumes.has(issue.id)) {
    try {
      await sendTelegramReply(config,
        `<i>Still processing your previous message, I'll get to this one next.</i>`,
        userMessageId
      );
    } catch { /* best effort */ }
    return;
  }

  // Find the session to resume: prefer the implementation session (phase 4),
  // fall back to the planning session, then any available session
  const sessionIds = (issue.phaseSessionIds as Record<string, string>) || {};
  const sessionId = sessionIds["4"] || issue.planningSessionId || Object.values(sessionIds).pop();

  if (!sessionId || !issue.worktreePath) {
    console.log(`[poller] No session/worktree for completed issue ${issue.id.substring(0, 8)}, skipping conversation`);
    return;
  }

  activeIssueResumes.add(issue.id);
  console.log(`[poller] Resuming session for completed issue ${issue.id.substring(0, 8)}: "${userText.substring(0, 80)}${userText.length > 80 ? "..." : ""}"`);

  try {
    const response = await resumeSession(sessionId, issue.worktreePath, userText);

    const truncated = response.length > TELEGRAM_SAFE_MSG_LEN
      ? response.substring(0, TELEGRAM_SAFE_MSG_LEN) + "..."
      : response;
    const responseHtml = markdownToTelegramHtml(truncated);
    const botMsgId = await sendTelegramReply(config, responseHtml, userMessageId);

    // Store Claude's response so the user can reply to it too (chain continues)
    await db.insert(issueMessages).values({
      issueId: issue.id,
      direction: "from_claude",
      message: response,
      telegramMessageId: botMsgId,
    });

    console.log(`[poller] Sent conversation response for issue ${issue.id.substring(0, 8)} (msgId: ${botMsgId})`);
  } catch (err) {
    console.error(`[poller] Error resuming session for issue ${issue.id.substring(0, 8)}:`, err);
    try {
      await sendTelegramReply(config,
        `<i>Something went wrong processing your reply. Please try again.</i>`,
        userMessageId
      );
    } catch { /* best effort */ }
  } finally {
    activeIssueResumes.delete(issue.id);
  }
}
