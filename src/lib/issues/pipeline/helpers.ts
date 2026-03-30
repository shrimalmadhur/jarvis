import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, issueMessages } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { sendTelegramMessageWithId, escapeHtml, TELEGRAM_SAFE_MSG_LEN } from "@/lib/notifications/telegram";
import { sendSlackMessage, SLACK_SAFE_MSG_LEN } from "@/lib/notifications/slack";
import type { IssueStatus, IssuesTransportConfig } from "../types";
import { QA_TIMEOUT_MS, PHASE_TIMEOUT_MS } from "../types";
import { runPhase } from "@/lib/harness/run-phase";
import type { HarnessType, HarnessPhaseResult } from "@/lib/harness/types";

export function telegramMarkupToSlackText(text: string): string {
  return text
    .replace(/<\/?(?:b|i|code|pre)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Files that should never be auto-committed. Tested against full path from git status. */
const SENSITIVE_FILE_PATTERN =
  /\.(env|pem|key|p12|pfx|jks|keystore)(\..*)?$|\.npmrc$|\.pypirc$|id_(rsa|ed25519|ecdsa|dsa)$|credentials\.json$/i;

export async function updatePhase(issueId: string, phase: number, status: IssueStatus) {
  await db.update(issues).set({
    currentPhase: phase,
    status,
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));
}

export async function failIssue(issueId: string, error: string) {
  await db.update(issues).set({
    status: "failed",
    error: error.substring(0, 10000),
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));
}

/** Check if the issue has been cancelled (status set to "failed" externally). */
export async function isCancelled(issueId: string): Promise<boolean> {
  const [issue] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId));
  return issue?.status === "failed";
}

export async function sendIssueTransportMessage(
  issueId: string,
  config: IssuesTransportConfig,
  text: string
): Promise<{ messageId?: number; slackTs?: string }> {
  if (config.kind === "telegram") {
    const truncated = text.length > 4096 ? text.substring(0, 4093) + "..." : text;
    const messageId = await sendTelegramMessageWithId(config, truncated);
    return { messageId };
  }

  const [issue] = await db.select({
    slackChannelId: issues.slackChannelId,
    slackThreadTs: issues.slackThreadTs,
  }).from(issues).where(eq(issues.id, issueId)).limit(1);

  if (!issue?.slackChannelId || !issue.slackThreadTs) {
    throw new Error("Slack issue thread metadata missing");
  }

  const result = await sendSlackMessage(
    { botToken: config.botToken },
    issue.slackChannelId,
    telegramMarkupToSlackText(text).substring(0, SLACK_SAFE_MSG_LEN),
    issue.slackThreadTs
  );

  return { slackTs: result.ts };
}

export async function notify(issueId: string, config: IssuesTransportConfig, text: string) {
  try {
    await sendIssueTransportMessage(issueId, config, text);
  } catch (err) {
    console.error("Failed to send issue notification:", err);
  }
}

export async function handleQuestions(
  issueId: string,
  questions: string,
  config: IssuesTransportConfig
): Promise<boolean> {
  const truncatedQ = config.kind === "telegram" && questions.length > TELEGRAM_SAFE_MSG_LEN
    ? questions.substring(0, TELEGRAM_SAFE_MSG_LEN) + "..."
    : questions;

  // Capture time BEFORE sending so we don't miss fast replies
  const questionTime = new Date();

  if (config.kind === "telegram") {
    const msgId = await sendTelegramMessageWithId(config,
      `Questions for issue <code>${issueId.substring(0, 8)}</code>:\n\n${escapeHtml(truncatedQ)}\n\n<i>Reply to this message to answer.</i>`
    );

    await db.insert(issueMessages).values({
      issueId,
      direction: "from_claude",
      message: questions,
      telegramMessageId: msgId,
    });
  } else {
    const result = await sendIssueTransportMessage(
      issueId,
      config,
      `Questions for issue ${issueId.substring(0, 8)}:\n\n${truncatedQ}\n\nReply in this Slack thread to answer.`
    );

    await db.insert(issueMessages).values({
      issueId,
      direction: "from_claude",
      message: questions,
      slackMessageTs: result.slackTs,
    });
  }

  await db.update(issues).set({ status: "waiting_for_input", updatedAt: new Date() }).where(eq(issues.id, issueId));

  // Wait for reply (polling for user replies newer than the question)
  const startWait = Date.now();
  while (Date.now() - startWait < QA_TIMEOUT_MS) {
    // Check cancellation
    if (await isCancelled(issueId)) return false;

    const [userReply] = await db.select().from(issueMessages)
      .where(and(
        eq(issueMessages.issueId, issueId),
        eq(issueMessages.direction, "from_user"),
        gt(issueMessages.createdAt, questionTime)
      ))
      .limit(1);

    if (userReply) return true;
    await new Promise(r => setTimeout(r, 5000));
  }

  return false;
}

export async function getUserAnswers(issueId: string): Promise<string | null> {
  const messages = await db.select().from(issueMessages)
    .where(and(eq(issueMessages.issueId, issueId), eq(issueMessages.direction, "from_user")))
    .orderBy(issueMessages.createdAt);

  if (messages.length === 0) return null;
  return messages.map(m => m.message).join("\n\n");
}

/** Extract a HarnessPhaseResult from a settled promise, returning a failure result on rejection. */
export function settledResult(r: PromiseSettledResult<HarnessPhaseResult>): HarnessPhaseResult {
  if (r.status === "fulfilled") return r.value;
  return { success: false, output: `Agent failed: ${String(r.reason)}` };
}

/** Verify worktree is clean after parallel read-only reviewers. Reset if dirty. */
export function ensureWorktreeClean(worktreeDir: string): void {
  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreeDir, encoding: "utf-8",
    }).trim();
    if (status) {
      console.warn("[pipeline] Review agents modified worktree unexpectedly, resetting");
      execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: worktreeDir, stdio: "ignore" });
      execFileSync("git", ["clean", "-fd"], { cwd: worktreeDir, stdio: "ignore" });
    }
  } catch (err) {
    console.error("[pipeline] ensureWorktreeClean failed:", err);
  }
}

/**
 * Auto-commit any uncommitted changes left behind by a phase.
 * Prevents ensureWorktreeClean() from wiping real implementation work.
 * Returns true if an auto-commit was created, false if worktree was already clean.
 */
export function autoCommitUncommittedChanges(worktreeDir: string, commitMessage: string): boolean {
  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreeDir, encoding: "utf-8",
    }).trim();

    if (!status) return false;

    // Porcelain format: 2-char status prefix + space + path (e.g., "?? file.txt", " M file.txt")
    const lines = status.split("\n").filter(Boolean);
    console.warn(`[pipeline] Auto-committing ${lines.length} uncommitted changes:`);
    for (const l of lines) console.warn(`  ${l}`);

    // Stage tracked file modifications
    execFileSync("git", ["add", "-u"], { cwd: worktreeDir, stdio: "ignore" });

    // Stage genuinely new files, skipping secrets/artifacts
    const untracked = lines.filter(l => l.startsWith("??"));
    const toStage: string[] = [];
    for (const line of untracked) {
      // Porcelain format: path starts at index 3. Git quotes paths with spaces/unicode.
      let filePath = line.slice(3);
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      if (SENSITIVE_FILE_PATTERN.test(filePath)) {
        console.warn(`[pipeline] Skipping suspicious file: ${filePath}`);
        continue;
      }
      toStage.push(filePath);
    }
    if (toStage.length) {
      execFileSync("git", ["add", "--", ...toStage], { cwd: worktreeDir, stdio: "ignore" });
    }

    execFileSync("git", ["commit", "-m", commitMessage], {
      cwd: worktreeDir, encoding: "utf-8",
    });
    return true;
  } catch (err) {
    console.error("[pipeline] autoCommitUncommittedChanges failed:", err);
    // Unstage to leave worktree in a predictable state for retry
    try { execFileSync("git", ["reset", "HEAD"], { cwd: worktreeDir, stdio: "ignore" }); } catch { /* ignore */ }
    return false;
  }
}

/** Check whether the branch has any commits beyond the base branch. */
export function hasBranchCommits(worktreeDir: string, baseBranch: string): boolean {
  try {
    const log = execFileSync("git", ["log", `${baseBranch}..HEAD`, "--oneline"], {
      cwd: worktreeDir, encoding: "utf-8",
    }).trim();
    return log.length > 0;
  } catch (err) {
    console.error(`[pipeline] Cannot compare against base branch '${baseBranch}':`, err);
    return false;
  }
}

/** Create a fresh planning session with a new UUID. Updates planningSessionId in DB. */
export async function createFreshPlanningSession(
  workdir: string,
  prompt: string,
  issueId: string,
  harness?: HarnessType,
): Promise<{ result: HarnessPhaseResult; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const result = await runPhase({
    workdir,
    prompt,
    systemPrompt: "You are an expert implementation planner. Create detailed, actionable plans.",
    timeoutMs: PHASE_TIMEOUT_MS,
    sessionId,
    harness,
  });
  // For Codex, the actual session ID comes from the result (thread_id)
  const effectiveSessionId = result.sessionId || sessionId;
  await db.update(issues).set({ planningSessionId: effectiveSessionId, updatedAt: new Date() })
    .where(eq(issues.id, issueId));
  return { result, sessionId: effectiveSessionId };
}
