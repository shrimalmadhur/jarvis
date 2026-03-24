import { db } from "@/lib/db";
import { issues, notificationConfigs } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull, lt, sql } from "drizzle-orm";
import { getIssuesTelegramConfig, pollTelegramUpdates, processTelegramUpdate } from "./telegram-poller";
import { runIssuePipeline } from "./pipeline";
import type { IssuesTelegramConfig } from "./types";

// Stale lock threshold: 4 hours (covers worst-case pipeline: 3 plan iterations + impl + reviews + QA waits)
const STALE_LOCK_MS = 4 * 60 * 60 * 1000;
// Max concurrent pipelines
const MAX_CONCURRENT_PIPELINES = 2;

// Use globalThis to survive HMR in dev
const g = globalThis as unknown as { _issuePoller?: { running: boolean; starting: boolean } };
g._issuePoller ??= { running: false, starting: false };

/**
 * Ensure the Telegram issue poller is running in-process.
 * Safe to call multiple times — only one poller loop will run.
 *
 * Called eagerly from instrumentation.ts on server startup, and also from
 * API routes as a fallback retry — if the eager start crashes (e.g. DB
 * not ready), the next API request will re-trigger it.
 */
export function ensurePollerRunning(): void {
  if (g._issuePoller!.running || g._issuePoller!.starting) return;
  g._issuePoller!.starting = true;

  // Defer startup so the current request completes first.
  // Next.js dev compiles API routes in Node.js workers where bun:sqlite
  // isn't available — the DB proxy handles this for request handlers but
  // the poller runs outside that lifecycle. Deferring ensures the DB
  // is initialized through the normal request path first.
  setTimeout(() => {
    runPoller().catch((err) => {
      console.error("[issue-poller] Fatal error:", err);
      g._issuePoller!.running = false;
      g._issuePoller!.starting = false;
    });
  }, 5000);
}

// ── Shared poller logic (used by both in-process and standalone script) ──

export async function getOffset(): Promise<number> {
  const [row] = await db.select().from(notificationConfigs)
    .where(eq(notificationConfigs.channel, "telegram-issues-offset")).limit(1);
  return row ? parseInt((row.config as Record<string, string>).offset || "0") : 0;
}

export async function setOffset(offset: number) {
  const [existing] = await db.select().from(notificationConfigs)
    .where(eq(notificationConfigs.channel, "telegram-issues-offset")).limit(1);
  if (existing) {
    await db.update(notificationConfigs)
      .set({ config: { offset: String(offset) }, updatedAt: new Date() })
      .where(eq(notificationConfigs.id, existing.id));
  } else {
    await db.insert(notificationConfigs).values({
      channel: "telegram-issues-offset",
      enabled: true,
      config: { offset: String(offset) },
    });
  }
}

/** Clear locks that are older than STALE_LOCK_MS (e.g. from crashed processes). */
export async function clearStaleLocks() {
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS);
  const stale = await db.update(issues).set({ lockedBy: null, lockedAt: null })
    .where(and(isNotNull(issues.lockedBy), lt(issues.lockedAt, staleThreshold)))
    .returning({ id: issues.id });
  if (stale.length > 0) {
    console.log(`[issue-poller] Cleared ${stale.length} stale lock(s)`);
  }
}

/** Clear ALL locks unconditionally. Called on poller startup since no pipeline
 *  from a previous process can still be running after a restart. */
export async function clearAllLocks() {
  const cleared = await db.update(issues).set({ lockedBy: null, lockedAt: null })
    .where(isNotNull(issues.lockedBy))
    .returning({ id: issues.id });
  if (cleared.length > 0) {
    console.log(`[issue-poller] Startup: cleared ${cleared.length} orphaned lock(s) from previous process`);
  }
}

export async function startPendingPipelines(config: IssuesTelegramConfig) {
  // Check how many pipelines are currently running
  const [{ activeCount }] = await db.select({ activeCount: sql<number>`count(*)` })
    .from(issues).where(isNotNull(issues.lockedBy));
  if (activeCount >= MAX_CONCURRENT_PIPELINES) return;

  const slotsAvailable = MAX_CONCURRENT_PIPELINES - activeCount;
  const pendingIssues = await db.select().from(issues)
    .where(and(eq(issues.status, "pending"), isNull(issues.lockedBy)))
    .orderBy(issues.createdAt)
    .limit(slotsAvailable);

  for (const issue of pendingIssues) {
    const lockId = crypto.randomUUID();
    await db.update(issues).set({
      lockedAt: new Date(),
      lockedBy: lockId,
      updatedAt: new Date(),
    }).where(and(eq(issues.id, issue.id), isNull(issues.lockedBy)));

    const [locked] = await db.select().from(issues).where(eq(issues.id, issue.id));
    if (locked?.lockedBy !== lockId) continue;

    console.log(`[issue-poller] Starting pipeline: ${issue.title} (${issue.id.substring(0, 8)})`);

    runIssuePipeline(issue.id, config)
      .catch(err => console.error(`[issue-poller] Pipeline failed for ${issue.id}:`, err))
      .finally(async () => {
        await db.update(issues).set({ lockedBy: null, lockedAt: null })
          .where(and(eq(issues.id, issue.id), eq(issues.lockedBy, lockId)));
      });
  }
}

export async function startResumedPipelines(config: IssuesTelegramConfig) {
  // Respect concurrency cap (same as startPendingPipelines)
  const [{ activeCount }] = await db.select({ activeCount: sql<number>`count(*)` })
    .from(issues).where(isNotNull(issues.lockedBy));
  if (activeCount >= MAX_CONCURRENT_PIPELINES) return;

  const slotsAvailable = MAX_CONCURRENT_PIPELINES - activeCount;
  const resumedIssues = await db.select().from(issues)
    .where(and(
      sql`${issues.status} NOT IN ('pending', 'completed', 'failed', 'waiting_for_input')`,
      isNull(issues.lockedBy)
    ))
    .limit(slotsAvailable);

  for (const issue of resumedIssues) {
    const lockId = crypto.randomUUID();
    await db.update(issues).set({ lockedBy: lockId, lockedAt: new Date() })
      .where(and(eq(issues.id, issue.id), isNull(issues.lockedBy)));

    const [locked] = await db.select().from(issues).where(eq(issues.id, issue.id));
    if (locked?.lockedBy !== lockId) continue;

    console.log(`[issue-poller] Resuming pipeline: ${issue.title} (${issue.id.substring(0, 8)})`);

    runIssuePipeline(issue.id, config)
      .catch(err => console.error(`[issue-poller] Pipeline failed for ${issue.id}:`, err))
      .finally(async () => {
        await db.update(issues).set({ lockedBy: null, lockedAt: null })
          .where(and(eq(issues.id, issue.id), eq(issues.lockedBy, lockId)));
      });
  }
}

/** Run one iteration of the poller (poll Telegram, start/resume pipelines). */
export async function runPollerIteration(config: IssuesTelegramConfig, offset: number): Promise<number> {
  const { updates, nextOffset } = await pollTelegramUpdates(config.botToken, offset);
  await setOffset(nextOffset);

  for (const update of updates) {
    await processTelegramUpdate(update, config);
  }

  await clearStaleLocks();
  await startPendingPipelines(config);
  await startResumedPipelines(config);

  return nextOffset;
}

// ── In-process poller loop ──

async function runPoller() {
  console.log("[issue-poller] Starting in-process poller...");

  let config: IssuesTelegramConfig | null = null;
  while (!config) {
    config = await getIssuesTelegramConfig();
    if (!config) {
      await new Promise(r => setTimeout(r, 30000));
    }
  }

  g._issuePoller!.running = true;
  g._issuePoller!.starting = false;
  console.log("[issue-poller] Telegram config found, polling started");

  // On fresh start, clear all locks — any locked pipelines from a previous
  // process are dead and won't release their locks on their own.
  await clearAllLocks();

  let offset = await getOffset();

  while (true) {
    try {
      const freshConfig = await getIssuesTelegramConfig();
      if (freshConfig) {
        config = freshConfig;
      } else {
        // Config was deleted — pause until re-configured
        console.log("[issue-poller] Telegram config removed, pausing...");
        while (!await getIssuesTelegramConfig()) {
          await new Promise(r => setTimeout(r, 30000));
        }
        config = (await getIssuesTelegramConfig())!;
        console.log("[issue-poller] Telegram config restored, resuming");
        offset = await getOffset();
        continue;
      }

      offset = await runPollerIteration(config, offset);
    } catch (err) {
      console.error("[issue-poller] Error:", err);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
