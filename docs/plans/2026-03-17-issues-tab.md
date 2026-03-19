# Issues Tab - Autonomous Code Implementation via Telegram

## Review Summary
**Adversarial Review**: Passed (Round 2) — All 4 CRITICAL issues from R1 confirmed resolved. 6 remaining WARNINGs (non-blocking, addressed in implementation notes below).
**Completeness Review**: Passed (Round 2) — All 17 R1 gaps fixed. 3 remaining logic gaps addressed in implementation notes below.
**Revision rounds**: 2
**Implementation notes from R2 reviews** (to address during coding):
- Pipeline must re-enter at `currentPhase` on resume (not restart from Phase 1)
- Use `UPDATE ... RETURNING` for atomic advisory locking
- `startResumedPipelines` must only pick up issues that transitioned from `waiting_for_input`
- Use structured sentinel (`VERDICT: PASS` / `VERDICT: FAIL`) in reviewer prompts instead of fragile regex
- Truncate Telegram messages to 4096 char limit
- No concurrency limits — pipelines run fully in parallel as they arrive
- Export `escapeHtml` in Task 3 alongside other telegram.ts changes
- Add `IssueStatus` to pipeline.ts imports
- Move all imports to top of telegram-poller.ts

## Overview

Add an "Issues" tab to Jarvis where users configure repositories (GitHub repo URL + local repo path). Issues arrive via Telegram messages to a **dedicated issues bot** (separate from the notification bot). When an issue arrives, Jarvis autonomously:

1. Creates a git worktree in the configured repo
2. Plans the implementation (Claude Code)
3. Reviews the plan (2 rounds, separate Claude instances)
4. Implements the plan (Claude Code in worktree)
5. Reviews the code (2 rounds of adversarial review)
6. Creates a PR

All phases run with `--dangerously-skip-permissions`. If Claude's output contains questions, the pipeline re-runs that phase with the user's Telegram reply injected as additional context. Sessions are viewable in the UI and resumable via CLI.

---

## Architecture

```
Telegram Issues Bot (DEDICATED bot, separate from notification bot)
  │
  ▼
Telegram Poller (background script, long-polling with persisted offset)
  │ parses: /issue RepoName: description...
  │ matches replies to questions via reply_to_message_id
  ▼
Issue Pipeline Orchestrator (scripts/issue-pipeline.ts)
  │ picks up pending issues from DB (with advisory locking)
  │ pipelines run in parallel, no concurrency limits
  │ runs multi-phase pipeline per issue
  │
  ├── Phase 1: Planning (claude -p in worktree, stdin prompt)
  ├── Phase 2: Plan Review #1 (claude -p, adversarial reviewer)
  ├── Phase 3: Plan Review #2 (claude -p, completeness reviewer)
  ├── Phase 4: Implementation (claude -p in worktree)
  ├── Phase 5: Code Review #1 (claude -p, find + fix bugs)
  ├── Phase 6: Code Review #2 (claude -p, verify all fixes + tests)
  ├── Phase 7: PR Creation (claude -p, gh pr create)
  │
  ▼
Jarvis UI (Issues Tab)
  ├── Repo config (repo paths, dedicated telegram bot config)
  ├── Issues list with status pipeline
  ├── Issue detail (phases, Q&A thread, session info)
  └── Resume: claude --resume <session-id>
```

---

## Key Design Decisions

1. **Dedicated Telegram bot for issues**: The Telegram Bot API only allows one `getUpdates` consumer per bot token. Using a separate bot avoids conflicts with the existing global notification bot. Config stored in `notification_configs` with channel `"telegram-issues"`.

2. **`claude -p` is fire-and-forget for Q&A**: `-p` mode is non-interactive batch mode. There is no way to pause mid-session. If Claude's output contains questions (detected by parsing for "## Questions" section), the pipeline sends questions to Telegram, waits for a reply, then **re-runs the phase** with the user's answer appended to the prompt. This means the phase starts fresh with additional context, not resuming mid-conversation.

3. **Session ID via `--session-id` flag**: Rather than relying on `session_id` in stream-json output (which is unverified), we pre-generate a UUID and pass `--session-id <uuid>` to each Claude CLI invocation. This guarantees a known session ID. Session IDs per phase are stored as JSON in the issues table.

4. **Telegram polling (not webhooks)**: Local-first app has no public URL. Long-polling with 30s timeout is reliable. The `getUpdates` offset is persisted to DB to survive restarts.

5. **Repositories (not "issue_projects")**: To avoid confusion with the existing `projects` table, the new table is called `repositories` — it represents code repos to work on.

6. **No concurrency limits**: Pipelines run fully in parallel as issues arrive. Advisory locking via `lockedAt`/`lockedBy` columns prevents the same issue from being picked up twice by the poller.

7. **Claude manages worktrees**: Pass `--worktree` to `claude -p` and it creates/manages worktrees automatically. No manual `git worktree add/remove`. The pipeline runs with `cwd` set to `localRepoPath` and Claude handles the rest.

8. **Plan review has max 3 iterations**: If the planner can't produce a plan that passes review after 3 attempts, the issue is marked `failed`.

9. **Resume command**: `claude --resume <session-id>` — the session knows its worktree context.

---

## Phase-to-Status Mapping

| Phase | Status | Description |
|-------|--------|-------------|
| 0 | `pending` | Issue created, waiting to be picked up |
| 1 | `planning` | Creating implementation plan |
| 2 | `reviewing_plan_1` | Adversarial plan review |
| 3 | `reviewing_plan_2` | Completeness plan review |
| 4 | `implementing` | Coding the solution |
| 5 | `reviewing_code_1` | First code review (find + fix) |
| 6 | `reviewing_code_2` | Second code review (verify) |
| 7 | `creating_pr` | Creating pull request |
| - | `completed` | PR created successfully |
| - | `failed` | Pipeline failed at some phase |
| - | `waiting_for_input` | Waiting for user reply via Telegram |

---

## Implementation Plan

### Task 1: Database Schema

**File: `src/lib/db/schema.ts`**

Add three new tables after the existing `agentRunToolUses` table:

```typescript
// ── Repositories (for issue tracking) ────────────────────────
export const repositories = sqliteTable("repositories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  githubRepoUrl: text("github_repo_url"),          // e.g. "https://github.com/user/repo"
  localRepoPath: text("local_repo_path").notNull(), // e.g. "/home/user/projects/repo"
  defaultBranch: text("default_branch").notNull().default("main"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── Issues ───────────────────────────────────────────────────
export const issues = sqliteTable("issues", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  repositoryId: text("repository_id").references(() => repositories.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
    // pending | planning | reviewing_plan_1 | reviewing_plan_2 |
    // implementing | reviewing_code_1 | reviewing_code_2 |
    // creating_pr | completed | failed | waiting_for_input
  currentPhase: integer("current_phase").notNull().default(0), // 0-7
  telegramMessageId: integer("telegram_message_id"),
  telegramChatId: text("telegram_chat_id"),
  prUrl: text("pr_url"),
  // JSON object mapping phase number to session ID: { "1": "uuid", "4": "uuid", ... }
  phaseSessionIds: text("phase_session_ids", { mode: "json" }).$type<Record<string, string>>().default({}),
  planOutput: text("plan_output"),
  planReview1: text("plan_review_1"),
  planReview2: text("plan_review_2"),
  codeReview1: text("code_review_1"),
  codeReview2: text("code_review_2"),
  error: text("error"),
  // Advisory locking for concurrency control
  lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
  lockedBy: text("locked_by"), // process identifier
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

// ── Issue Messages (Q&A via Telegram) ────────────────────────
export const issueMessages = sqliteTable("issue_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  issueId: text("issue_id").references(() => issues.id, { onDelete: "cascade" }).notNull(),
  direction: text("direction").notNull(), // 'from_claude' | 'from_user'
  message: text("message").notNull(),
  telegramMessageId: integer("telegram_message_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});
```

**After editing schema.ts**, run:
```bash
bun run db:generate
```

**Verification**: `bun run tsc --noEmit` passes. Migration file created in `drizzle/`.

---

### Task 2: Types and Validation

**New file: `src/lib/issues/types.ts`**

```typescript
export const ISSUE_STATUSES = [
  "pending", "planning", "reviewing_plan_1", "reviewing_plan_2",
  "implementing", "reviewing_code_1", "reviewing_code_2",
  "creating_pr", "completed", "failed", "waiting_for_input",
] as const;
export type IssueStatus = typeof ISSUE_STATUSES[number];

export const PHASE_STATUS_MAP: Record<number, IssueStatus> = {
  0: "pending",
  1: "planning",
  2: "reviewing_plan_1",
  3: "reviewing_plan_2",
  4: "implementing",
  5: "reviewing_code_1",
  6: "reviewing_code_2",
  7: "creating_pr",
};

export const MAX_PLAN_ITERATIONS = 3;
export const MAX_CONCURRENT_PER_REPO = 2;
export const MAX_CONCURRENT_GLOBAL = 4;
export const PHASE_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
export const IMPL_TIMEOUT_MS = 30 * 60 * 1000;  // 30 min
export const QA_TIMEOUT_MS = 30 * 60 * 1000;     // 30 min wait for reply

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    reply_to_message?: {
      message_id: number;
    };
  };
}

export interface PipelinePhaseResult {
  success: boolean;
  output: string;
  sessionId?: string;
  hasQuestions?: boolean;
  questions?: string;
}

export interface IssuesTelegramConfig {
  botToken: string;
  chatId: string;
}
```

**New file: `src/lib/validations/repository.ts`**

```typescript
import { z } from "zod";

export const createRepositorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  githubRepoUrl: z.string().url("Invalid URL").optional().or(z.literal("")),
  localRepoPath: z.string().min(1, "Local repo path is required"),
  defaultBranch: z.string().min(1).max(100).default("main"),
});

export const updateRepositorySchema = createRepositorySchema.partial();
```

**Verification**: `bun run tsc --noEmit`

---

### Task 3: Telegram Utilities Extension

**File: `src/lib/notifications/telegram.ts`** — Modify existing

Add a new function that sends a message and returns the `message_id`:

```typescript
/**
 * Send a Telegram message and return the message_id from the response.
 * Used by the issues Q&A flow to track reply_to_message_id.
 */
export async function sendTelegramMessageWithId(
  config: TelegramConfig,
  text: string
): Promise<number> {
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

  const result = await response.json() as { ok: boolean; result: { message_id: number } };
  return result.result.message_id;
}
```

Also export `TelegramConfig` type (it's currently a private interface).

**Verification**: `bun run tsc --noEmit`

---

### Task 4: Telegram Poller for Issues

**New file: `src/lib/issues/telegram-poller.ts`**

Key functions:

```typescript
import nodeFetch from "node-fetch";
import https from "node:https";
import { db } from "@/lib/db";
import { repositories, issues, issueMessages, notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { TelegramUpdate, IssuesTelegramConfig } from "./types";

const ipv4Agent = new https.Agent({ family: 4 });

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
    timeout: 35000, // slightly longer than Telegram's long-poll timeout
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
  const match = text.match(/^\/issue\s+(\S+)[:\s]+(.+)/s);
  if (!match) return null;
  return {
    repoName: match[1].trim(),
    description: match[2].trim(),
  };
}

/**
 * Process a single Telegram update.
 * - New /issue message: create issue in DB
 * - Reply to a Claude question: store as user reply
 * Validates that the chat_id matches the configured issues chat.
 */
export async function processTelegramUpdate(
  update: TelegramUpdate,
  config: IssuesTelegramConfig
): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  // Security: only accept messages from the configured chat
  if (String(msg.chat.id) !== config.chatId) return;

  // Check if this is a reply to a Claude question
  if (msg.reply_to_message) {
    const replyToMsgId = msg.reply_to_message.message_id;
    // Find the issue message this is replying to
    const [issueMsg] = await db
      .select()
      .from(issueMessages)
      .where(eq(issueMessages.telegramMessageId, replyToMsgId))
      .limit(1);

    if (issueMsg && issueMsg.direction === "from_claude") {
      // Store user reply
      await db.insert(issueMessages).values({
        issueId: issueMsg.issueId,
        direction: "from_user",
        message: msg.text,
        telegramMessageId: msg.message_id,
      });

      // If issue is waiting_for_input, update status back to the phase it was in
      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueMsg.issueId))
        .limit(1);

      if (issue?.status === "waiting_for_input") {
        const resumeStatus = PHASE_STATUS_MAP[issue.currentPhase] || "pending";
        await db.update(issues)
          .set({ status: resumeStatus, updatedAt: new Date() })
          .where(eq(issues.id, issue.id));
      }
      return;
    }
  }

  // Check if this is a new issue
  const parsed = parseIssueMessage(msg.text);
  if (!parsed) return;

  // Look up repository
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.name, parsed.repoName))
    .limit(1);

  if (!repo) {
    // Send error back to Telegram
    await sendTelegramNotification(config,
      `❌ Repository "<b>${escapeHtml(parsed.repoName)}</b>" not found. ` +
      `Available repos: check the Issues tab in Jarvis UI.`
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

  await sendTelegramNotification(config,
    `📋 Issue created: <b>${escapeHtml(title)}</b>\n` +
    `Repository: ${escapeHtml(repo.name)}\n` +
    `ID: <code>${newIssue.id.substring(0, 8)}</code>`
  );
}

// Import PHASE_STATUS_MAP from types
import { PHASE_STATUS_MAP } from "./types";
import { escapeHtml } from "@/lib/notifications/telegram";

// Helper to send notifications via the issues bot
async function sendTelegramNotification(config: IssuesTelegramConfig, text: string) {
  const { sendTelegramMessage } = await import("@/lib/notifications/telegram");
  await sendTelegramMessage(config, text);
}
```

**Persist offset**: Store in `notification_configs` table with channel `"telegram-issues-offset"` and config `{ offset: "123" }`.

**Verification**: Unit tests for `parseIssueMessage`.

---

### Task 5: Issue Pipeline Orchestrator

**New file: `src/lib/issues/pipeline.ts`**

Core pipeline that runs each phase as a separate `claude -p` invocation.

```typescript
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, issueMessages, repositories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { sendTelegramMessageWithId, sendTelegramMessage } from "@/lib/notifications/telegram";
import type { IssuesTelegramConfig, PipelinePhaseResult } from "./types";
import {
  PHASE_STATUS_MAP, MAX_PLAN_ITERATIONS,
  PHASE_TIMEOUT_MS, IMPL_TIMEOUT_MS, QA_TIMEOUT_MS,
} from "./types";
```

**`runClaudePhase` function** (core helper used by all phases):
```typescript
/**
 * Run a single Claude CLI phase.
 * - Prompt is piped via stdin (consistent with agent-runner.ts pattern)
 * - Uses --worktree so Claude manages worktree creation automatically
 * - Uses --session-id with pre-generated UUID for known session IDs
 * - Parses stream-json output for result text
 */
async function runClaudePhase(opts: {
  repoPath: string;   // local repo path — Claude creates worktree from here
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  sessionId?: string; // pre-generated UUID
  useWorktree?: boolean; // default true
}): Promise<PipelinePhaseResult> {
  const sessionId = opts.sessionId || crypto.randomUUID();
  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--session-id", sessionId,
  ];
  if (opts.useWorktree !== false) {
    args.push("--worktree");
  }
  if (opts.systemPrompt) {
    args.push("--append-system-prompt", opts.systemPrompt);
  }

  const timeout = opts.timeoutMs || PHASE_TIMEOUT_MS;

  return new Promise<PipelinePhaseResult>((resolve) => {
    const proc = spawn(resolveClaudePath(), args, {
      cwd: opts.repoPath,
      env: { ...process.env },
    });

    // Pipe prompt via stdin (same as agent-runner.ts lines 127-128)
    proc.stdin!.write(opts.prompt);
    proc.stdin!.end();

    let buffer = "";
    let resultText = "";
    const assistantBlocks: string[] = [];

    const timer = setTimeout(() => { proc.kill("SIGTERM"); }, timeout);

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "result" && event.result) {
            resultText = event.result;
          }
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                assistantBlocks.push(block.text);
              }
            }
          }
        } catch { /* skip non-JSON lines */ }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const output = resultText.trim() || assistantBlocks.join("\n\n");
      const hasQuestions = /##\s*Questions/i.test(output);
      const questions = hasQuestions
        ? output.substring(output.search(/##\s*Questions/i))
        : undefined;

      resolve({
        success: code === 0,
        output,
        sessionId,
        hasQuestions,
        questions,
      });
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ success: false, output: "", sessionId });
    });
  });
}
```

**`runIssuePipeline` function** (main orchestrator):

```typescript
export async function runIssuePipeline(
  issueId: string,
  telegramConfig: IssuesTelegramConfig
): Promise<void> {
  // Load issue and repository
  const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
  if (!issue) throw new Error(`Issue ${issueId} not found`);

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, issue.repositoryId));
  if (!repo) throw new Error(`Repository not found for issue ${issueId}`);

  // Pre-flight: verify repo exists and is a git repo
  if (!existsSync(repo.localRepoPath)) {
    await failIssue(issueId, `Repository path does not exist: ${repo.localRepoPath}`);
    return;
  }
  try {
    execSync("git rev-parse --git-dir", { cwd: repo.localRepoPath, stdio: "ignore" });
  } catch {
    await failIssue(issueId, `Not a git repository: ${repo.localRepoPath}`);
    return;
  }

  // Pre-flight: verify gh CLI is available
  try {
    execSync("gh auth status", { cwd: repo.localRepoPath, stdio: "ignore" });
  } catch {
    await failIssue(issueId, "gh CLI not authenticated. Run: gh auth login");
    return;
  }

  // Create worktree
  const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 40);
  const shortId = issue.id.substring(0, 8);
  const branchName = `issue/${slug}-${shortId}`;
  const worktreeDir = join(repo.localRepoPath, ".jarvis-worktrees", `${slug}-${shortId}`);

  mkdirSync(join(repo.localRepoPath, ".jarvis-worktrees"), { recursive: true });

  // Handle case where branch already exists (retry scenario)
  try {
    execSync(`git worktree add "${worktreeDir}" -b "${branchName}" "${repo.defaultBranch}"`, {
      cwd: repo.localRepoPath, stdio: "ignore",
    });
  } catch {
    // Branch might already exist from a previous attempt
    try {
      execSync(`git worktree add "${worktreeDir}" "${branchName}"`, {
        cwd: repo.localRepoPath, stdio: "ignore",
      });
    } catch (e) {
      await failIssue(issueId, `Failed to create worktree: ${e}`);
      return;
    }
  }

  await db.update(issues).set({
    worktreePath: worktreeDir,
    branchName,
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));

  const phaseSessionIds: Record<string, string> = {};

  try {
    // ── Phase 1: Planning ──────────────────────────────────
    await updatePhase(issueId, 1, "planning");
    await notify(telegramConfig, `📋 Planning started for: <b>${escapeTitle(issue.title)}</b>`);

    let planOutput = "";
    let planIterations = 0;
    let planApproved = false;

    while (!planApproved && planIterations < MAX_PLAN_ITERATIONS) {
      planIterations++;

      // Build planning prompt with any previous review feedback
      let planPrompt = buildPlanningPrompt(issue.description);
      if (planOutput && issue.planReview1) {
        planPrompt += `\n\n## Previous Plan Review Feedback\n${issue.planReview1}`;
      }

      // Check for user answers to previous questions
      const userAnswers = await getUserAnswers(issueId);
      if (userAnswers) {
        planPrompt += `\n\n## User's Answers to Questions\n${userAnswers}`;
      }

      const planResult = await runClaudePhase({
        workdir: worktreeDir,
        prompt: planPrompt,
        systemPrompt: "You are an expert implementation planner. Create detailed, actionable plans.",
        timeoutMs: PHASE_TIMEOUT_MS,
      });

      if (!planResult.success) {
        await failIssue(issueId, `Planning failed: ${planResult.output}`);
        return;
      }

      phaseSessionIds["1"] = planResult.sessionId!;
      planOutput = planResult.output;
      await db.update(issues).set({
        planOutput,
        phaseSessionIds,
        updatedAt: new Date(),
      }).where(eq(issues.id, issueId));

      // Handle questions
      if (planResult.hasQuestions && planResult.questions) {
        const answered = await handleQuestions(
          issueId, planResult.questions, telegramConfig
        );
        if (!answered) {
          await failIssue(issueId, "Timed out waiting for user reply to questions");
          return;
        }
        continue; // Re-run planning with answers
      }

      // ── Phase 2: Plan Review #1 ──────────────────────────
      await updatePhase(issueId, 2, "reviewing_plan_1");
      await notify(telegramConfig, `🔍 Plan review #1 started`);

      const review1Result = await runClaudePhase({
        workdir: worktreeDir,
        prompt: buildAdversarialReviewPrompt(planOutput),
        systemPrompt: "You are an adversarial plan reviewer. Find problems, not validate.",
        timeoutMs: PHASE_TIMEOUT_MS,
      });

      phaseSessionIds["2"] = review1Result.sessionId!;
      await db.update(issues).set({
        planReview1: review1Result.output,
        phaseSessionIds,
        updatedAt: new Date(),
      }).where(eq(issues.id, issueId));

      // Check for CRITICAL issues
      if (/CRITICAL/i.test(review1Result.output) && !/no\s+(?:critical\s+)?issues?\s+found/i.test(review1Result.output)) {
        await notify(telegramConfig, `⚠️ Plan review found critical issues. Re-planning (attempt ${planIterations + 1}/${MAX_PLAN_ITERATIONS})...`);
        continue; // Loop back to planning
      }

      // ── Phase 3: Plan Review #2 ──────────────────────────
      await updatePhase(issueId, 3, "reviewing_plan_2");
      await notify(telegramConfig, `🔍 Plan review #2 started`);

      const review2Result = await runClaudePhase({
        workdir: worktreeDir,
        prompt: buildCompletenessReviewPrompt(planOutput, review1Result.output),
        systemPrompt: "You are a completeness and feasibility reviewer. Find gaps.",
        timeoutMs: PHASE_TIMEOUT_MS,
      });

      phaseSessionIds["3"] = review2Result.sessionId!;
      await db.update(issues).set({
        planReview2: review2Result.output,
        phaseSessionIds,
        updatedAt: new Date(),
      }).where(eq(issues.id, issueId));

      // Check for blocking gaps
      if (/MISSING_STEP|WRONG_ASSUMPTION/i.test(review2Result.output) && !/plan\s+is\s+complete/i.test(review2Result.output)) {
        await notify(telegramConfig, `⚠️ Completeness review found gaps. Re-planning (attempt ${planIterations + 1}/${MAX_PLAN_ITERATIONS})...`);
        continue;
      }

      planApproved = true;
    }

    if (!planApproved) {
      await failIssue(issueId, `Plan could not pass review after ${MAX_PLAN_ITERATIONS} attempts`);
      await notify(telegramConfig, `❌ Planning failed after ${MAX_PLAN_ITERATIONS} attempts. Check the issue detail for review feedback.`);
      return;
    }

    await notify(telegramConfig, `✅ Plan approved. Starting implementation...`);

    // ── Phase 4: Implementation ────────────────────────────
    await updatePhase(issueId, 4, "implementing");

    let implPrompt = buildImplementationPrompt(planOutput, issue.planReview1 || "", issue.planReview2 || "");
    const userAnswers = await getUserAnswers(issueId);
    if (userAnswers) {
      implPrompt += `\n\n## Additional Context from User\n${userAnswers}`;
    }

    const implResult = await runClaudePhase({
      workdir: worktreeDir,
      prompt: implPrompt,
      systemPrompt: "You are an expert software engineer. Implement the plan precisely.",
      timeoutMs: IMPL_TIMEOUT_MS,
    });

    if (!implResult.success) {
      await failIssue(issueId, `Implementation failed: ${implResult.output}`);
      return;
    }

    phaseSessionIds["4"] = implResult.sessionId!;
    await db.update(issues).set({ phaseSessionIds, updatedAt: new Date() }).where(eq(issues.id, issueId));
    await notify(telegramConfig, `✅ Implementation complete. Starting code review...`);

    // ── Phase 5: Code Review #1 ────────────────────────────
    await updatePhase(issueId, 5, "reviewing_code_1");

    const cr1Result = await runClaudePhase({
      workdir: worktreeDir,
      prompt: buildCodeReview1Prompt(repo.defaultBranch),
      systemPrompt: "You are an expert code reviewer. Find and fix bugs, security issues, and design problems.",
      timeoutMs: PHASE_TIMEOUT_MS,
    });

    phaseSessionIds["5"] = cr1Result.sessionId!;
    await db.update(issues).set({
      codeReview1: cr1Result.output,
      phaseSessionIds,
      updatedAt: new Date(),
    }).where(eq(issues.id, issueId));
    await notify(telegramConfig, `🔍 Code review #1 complete`);

    // ── Phase 6: Code Review #2 (verify) ───────────────────
    await updatePhase(issueId, 6, "reviewing_code_2");

    const cr2Result = await runClaudePhase({
      workdir: worktreeDir,
      prompt: buildCodeReview2Prompt(repo.defaultBranch),
      systemPrompt: "You are a senior engineer performing final review. Verify correctness and test coverage.",
      timeoutMs: PHASE_TIMEOUT_MS,
    });

    phaseSessionIds["6"] = cr2Result.sessionId!;
    await db.update(issues).set({
      codeReview2: cr2Result.output,
      phaseSessionIds,
      updatedAt: new Date(),
    }).where(eq(issues.id, issueId));
    await notify(telegramConfig, `🔍 Code review #2 complete`);

    // ── Final: Run tests ───────────────────────────────────
    // Verify tests pass after all reviews/fixes
    const testResult = await runClaudePhase({
      workdir: worktreeDir,
      prompt: "Run the project's test suite and verify all tests pass. If any tests fail, fix them. Commit any fixes.",
      timeoutMs: PHASE_TIMEOUT_MS,
    });

    if (!testResult.success) {
      await failIssue(issueId, `Tests failed after code review: ${testResult.output}`);
      return;
    }

    // ── Phase 7: PR Creation ───────────────────────────────
    await updatePhase(issueId, 7, "creating_pr");

    const prResult = await runClaudePhase({
      workdir: worktreeDir,
      prompt: buildPrCreationPrompt(issue.title, issue.description, repo.defaultBranch),
      systemPrompt: "Create a pull request using the gh CLI.",
      timeoutMs: PHASE_TIMEOUT_MS,
    });

    if (!prResult.success) {
      await failIssue(issueId, `PR creation failed: ${prResult.output}`);
      return;
    }

    // Extract PR URL from output
    const prUrlMatch = prResult.output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
    const prUrl = prUrlMatch?.[0] || null;

    phaseSessionIds["7"] = prResult.sessionId!;
    await db.update(issues).set({
      status: "completed",
      prUrl,
      phaseSessionIds,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(issues.id, issueId));

    await notify(telegramConfig,
      `🎉 Issue completed: <b>${escapeTitle(issue.title)}</b>\n` +
      (prUrl ? `PR: ${prUrl}` : "PR created (check issue detail for link)")
    );

  } catch (err) {
    await failIssue(issueId, String(err));
    await notify(telegramConfig, `❌ Pipeline failed for: ${escapeTitle(issue.title)}\nError: ${String(err).substring(0, 200)}`);
  }
}
```

**Helper functions** (in same file):

```typescript
async function updatePhase(issueId: string, phase: number, status: IssueStatus) { ... }
async function failIssue(issueId: string, error: string) { ... }
async function notify(config: IssuesTelegramConfig, text: string) { ... }
function escapeTitle(title: string): string { ... } // HTML escape

async function handleQuestions(
  issueId: string,
  questions: string,
  config: IssuesTelegramConfig
): Promise<boolean> {
  // Send questions to Telegram and get message_id
  const msgId = await sendTelegramMessageWithId(config,
    `❓ Questions for issue <b>${issueId.substring(0, 8)}</b>:\n\n${questions}\n\n<i>Reply to this message to answer.</i>`
  );

  // Store as issue message
  await db.insert(issueMessages).values({
    issueId,
    direction: "from_claude",
    message: questions,
    telegramMessageId: msgId,
  });

  // Update status
  await db.update(issues).set({ status: "waiting_for_input", updatedAt: new Date() }).where(eq(issues.id, issueId));

  // Wait for reply (polling issue_messages table)
  const startWait = Date.now();
  while (Date.now() - startWait < QA_TIMEOUT_MS) {
    // Check for user reply in issue_messages
    const replies = await db.select().from(issueMessages)
      .where(eq(issueMessages.issueId, issueId))
      .orderBy(issueMessages.createdAt);

    const lastClaudeMsg = replies.filter(m => m.direction === "from_claude").pop();
    const userReply = replies.find(m =>
      m.direction === "from_user" &&
      m.createdAt > (lastClaudeMsg?.createdAt || new Date(0))
    );

    if (userReply) return true;
    await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
  }

  return false;
}

async function getUserAnswers(issueId: string): Promise<string | null> {
  const messages = await db.select().from(issueMessages)
    .where(eq(issueMessages.issueId, issueId))
    .orderBy(issueMessages.createdAt);

  const userMsgs = messages.filter(m => m.direction === "from_user");
  if (userMsgs.length === 0) return null;
  return userMsgs.map(m => m.message).join("\n\n");
}

// Prompt builders
function buildPlanningPrompt(description: string): string { ... }
function buildAdversarialReviewPrompt(plan: string): string { ... }
function buildCompletenessReviewPrompt(plan: string, review1: string): string { ... }
function buildImplementationPrompt(plan: string, review1: string, review2: string): string { ... }
function buildCodeReview1Prompt(defaultBranch: string): string { ... }
function buildCodeReview2Prompt(defaultBranch: string): string { ... }
function buildPrCreationPrompt(title: string, description: string, defaultBranch: string): string { ... }
```

**Verification**: `bun run tsc --noEmit`

---

### Task 6: Background Process Scripts

**New file: `scripts/issue-poller.ts`**

```typescript
import dotenv from "dotenv";
import fs from "node:fs";

// Load env (same pattern as run-agents.ts)
if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else if (fs.existsSync("/etc/jarvis/env")) {
  dotenv.config({ path: "/etc/jarvis/env" });
} else if (fs.existsSync(".env")) {
  dotenv.config({ path: ".env" });
}

import { getIssuesTelegramConfig, pollTelegramUpdates, processTelegramUpdate } from "../src/lib/issues/telegram-poller";
import { runIssuePipeline } from "../src/lib/issues/pipeline";
import { db } from "../src/lib/db";
import { issues } from "../src/lib/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { MAX_CONCURRENT_PER_REPO, MAX_CONCURRENT_GLOBAL } from "../src/lib/issues/types";
import { notificationConfigs } from "../src/lib/db/schema";

// Persist offset in DB
async function getOffset(): Promise<number> {
  const [row] = await db.select().from(notificationConfigs)
    .where(eq(notificationConfigs.channel, "telegram-issues-offset")).limit(1);
  return row ? parseInt((row.config as Record<string, string>).offset || "0") : 0;
}
async function setOffset(offset: number) {
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

async function startPendingPipelines(telegramConfig: { botToken: string; chatId: string }) {
  // Count currently running pipelines
  const runningCount = await db.select({ count: sql<number>`count(*)` })
    .from(issues)
    .where(and(
      sql`${issues.status} NOT IN ('pending', 'completed', 'failed', 'waiting_for_input')`,
      sql`${issues.lockedBy} IS NOT NULL`
    ));

  if (runningCount[0].count >= MAX_CONCURRENT_GLOBAL) return;

  // Find pending issues
  const pendingIssues = await db.select().from(issues)
    .where(eq(issues.status, "pending"))
    .orderBy(issues.createdAt)
    .limit(MAX_CONCURRENT_GLOBAL - runningCount[0].count);

  for (const issue of pendingIssues) {
    // Advisory lock
    const lockId = `poller-${process.pid}-${Date.now()}`;
    await db.update(issues).set({
      lockedAt: new Date(),
      lockedBy: lockId,
      updatedAt: new Date(),
    }).where(and(eq(issues.id, issue.id), isNull(issues.lockedBy)));

    // Verify we got the lock
    const [locked] = await db.select().from(issues).where(eq(issues.id, issue.id));
    if (locked?.lockedBy !== lockId) continue; // Another process got it

    // Run pipeline in background (don't await)
    runIssuePipeline(issue.id, telegramConfig)
      .catch(err => console.error(`Pipeline failed for issue ${issue.id}:`, err))
      .finally(async () => {
        // Release lock
        await db.update(issues).set({ lockedBy: null, lockedAt: null })
          .where(eq(issues.id, issue.id));
      });
  }
}

async function main() {
  console.log("Jarvis Issue Poller started");

  const config = await getIssuesTelegramConfig();
  if (!config) {
    console.error("No Telegram issues bot configured. Set up via Issues > Config in the UI.");
    console.log("Waiting for configuration...");

    // Poll for config every 30s
    while (true) {
      await new Promise(r => setTimeout(r, 30000));
      const c = await getIssuesTelegramConfig();
      if (c) { return main(); } // Restart with config
    }
  }

  let offset = await getOffset();
  console.log(`Resuming from offset: ${offset}`);

  while (true) {
    try {
      const { updates, nextOffset } = await pollTelegramUpdates(config.botToken, offset);
      offset = nextOffset;
      await setOffset(offset);

      for (const update of updates) {
        await processTelegramUpdate(update, config);
      }

      // Check for pending issues to start
      await startPendingPipelines(config);

      // Also check for issues that were waiting_for_input and got replies
      await startResumedPipelines(config);

    } catch (err) {
      console.error("Poller error:", err);
      await new Promise(r => setTimeout(r, 5000)); // Backoff on error
    }
  }
}

async function startResumedPipelines(config: IssuesTelegramConfig) {
  // Find issues that were waiting and now have user replies
  const waitingIssues = await db.select().from(issues)
    .where(and(
      sql`${issues.status} NOT IN ('pending', 'completed', 'failed', 'waiting_for_input')`,
      isNull(issues.lockedBy)
    ));

  for (const issue of waitingIssues) {
    const lockId = `poller-${process.pid}-${Date.now()}`;
    await db.update(issues).set({ lockedBy: lockId, lockedAt: new Date() })
      .where(and(eq(issues.id, issue.id), isNull(issues.lockedBy)));

    const [locked] = await db.select().from(issues).where(eq(issues.id, issue.id));
    if (locked?.lockedBy !== lockId) continue;

    runIssuePipeline(issue.id, config)
      .catch(err => console.error(`Pipeline failed for issue ${issue.id}:`, err))
      .finally(async () => {
        await db.update(issues).set({ lockedBy: null, lockedAt: null })
          .where(eq(issues.id, issue.id));
      });
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

**New file: `scripts/issue-pipeline.ts`** (CLI entry point for running single issue)

```typescript
import dotenv from "dotenv";
import fs from "node:fs";
// ... same env loading as above ...

import { runIssuePipeline } from "../src/lib/issues/pipeline";
import { getIssuesTelegramConfig } from "../src/lib/issues/telegram-poller";

async function main() {
  const args = process.argv.slice(2);
  const issueIdx = args.indexOf("--issue");
  if (issueIdx === -1 || !args[issueIdx + 1]) {
    console.error("Usage: bun run scripts/issue-pipeline.ts --issue <issue-id>");
    process.exit(1);
  }
  const issueId = args[issueIdx + 1];

  const config = await getIssuesTelegramConfig();
  if (!config) {
    console.error("No Telegram issues bot configured.");
    process.exit(1);
  }

  await runIssuePipeline(issueId, config);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
```

**Verification**: Scripts can be tested manually with `bun run --tsconfig tsconfig.runner.json scripts/issue-poller.ts`

---

### Task 7: API Routes

**New file: `src/app/api/issues/projects/route.ts`**

```typescript
// GET: List all repositories with issue counts
// POST: Create repository
//   - Validate with createRepositorySchema
//   - Verify localRepoPath exists (fs.existsSync)
//   - Verify it's a git repo (git rev-parse --git-dir)
//   - Check name uniqueness
```

**New file: `src/app/api/issues/projects/[id]/route.ts`**

```typescript
// GET: Single repository with issue count
// PATCH: Update (validate with updateRepositorySchema)
// DELETE: Delete (cascade deletes issues)
```

**New file: `src/app/api/issues/route.ts`**

```typescript
// GET: List all issues with repository name, status, timestamps
//   - ?repositoryId=xxx filter
//   - ?status=pending filter
//   - Ordered by createdAt desc
// POST: Create issue from UI (optional — primary flow is Telegram)
//   - repositoryId, title, description required
```

**New file: `src/app/api/issues/[id]/route.ts`**

```typescript
// GET: Full issue detail with repository info, messages, phase outputs, session IDs
// PATCH: Update issue (retry, cancel)
// DELETE: Clean up worktree (git worktree remove --force, git worktree prune), delete from DB
```

**New file: `src/app/api/issues/[id]/messages/route.ts`**

```typescript
// GET: Q&A thread for an issue, ordered by createdAt
```

**New file: `src/app/api/issues/[id]/retry/route.ts`**

```typescript
// POST: Retry a failed issue
//   - Resets status to the phase that failed (uses PHASE_STATUS_MAP)
//   - Clears error
//   - Clears lockedBy/lockedAt
//   - Pipeline will pick it up on next poll
```

**New file: `src/app/api/issues/telegram/route.ts`**

```typescript
// GET: Get issues Telegram bot config (channel: "telegram-issues")
// POST: Save/update issues Telegram bot config
// DELETE: Remove config
```

**Verification**: `bun run tsc --noEmit` after each route.

---

### Task 8: UI — Navigation Update

**File: `src/components/layout/top-nav.tsx`**

Add `Bug` to lucide imports and add Issues tab:

```typescript
import { Bug } from "lucide-react"; // add to existing imports

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/issues", label: "Issues", icon: Bug },        // NEW
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/sessions", label: "Sessions", icon: Terminal },
  { href: "/settings", label: "Settings", icon: Settings },
];
```

Add route matching in `isActive` (after the `/projects` line at line 73):
```typescript
(item.href === "/issues" && pathname.startsWith("/issues")) ||
```

**Verification**: Visual — tab appears, highlights correctly.

---

### Task 9: UI — Issues List Page

**New file: `src/app/(app)/issues/page.tsx`**

- Header: "Issues" title + "Config" link (to `/issues/config`) + filter bar
- Status filter tabs: All, In Progress, Completed, Failed
- Issue cards showing:
  - Repository name
  - Issue title
  - Status badge with color coding:
    - pending: muted
    - planning/reviewing/implementing: accent with pulse
    - waiting_for_input: amber
    - completed: green
    - failed: red
  - Pipeline progress: 7-dot visual indicator showing active phase
  - Created time (relative, using `date-fns`)
  - PR link if completed
- Auto-refresh every 5s while any issue is in progress
- Follow terminal aesthetic from projects/sessions pages

**Verification**: Visual — page renders, issues display correctly.

---

### Task 10: UI — Repository Config Page

**New file: `src/app/(app)/issues/config/page.tsx`**

- Header: "Issue Repositories" title
- Dedicated Telegram bot config section:
  - Bot token input
  - Chat ID input
  - Test connection button
  - (Uses `/api/issues/telegram` routes)
- Repository list with edit/delete
- "Add Repository" form:
  - Name (text, required)
  - Local repo path (text, required) — validates path exists on save
  - GitHub repo URL (text, optional)
  - Default branch (text, default "main")

**Verification**: Visual — can add/edit/delete repositories and configure Telegram bot.

---

### Task 11: UI — Issue Detail Page

**New file: `src/app/(app)/issues/[id]/page.tsx`**

**Header**:
- Issue title, repository name
- Status badge
- Created/updated/completed timestamps
- PR link button (if completed)

**Pipeline progress** (horizontal bar):
- 7 phase circles connected by lines
- Each shows: phase name below, status icon above
- Active phase: accent color + pulse animation
- Completed: green check
- Failed: red X
- Pending: muted dot

**Phase outputs** (collapsible accordion sections):
- Plan (markdown via `react-markdown`)
- Plan Review #1 (markdown)
- Plan Review #2 (markdown)
- Code Review #1 (markdown)
- Code Review #2 (markdown)

**Q&A Thread**:
- Chronological message list
- Claude messages: left-aligned with accent border
- User replies: right-aligned
- Waiting indicator if status is `waiting_for_input`

**Actions section**:
- "Retry" button (shown for failed issues)
- "Cancel" button (shown for in-progress issues)
- "Resume in CLI" — code block showing:
  ```
  cd /path/to/worktree && claude --resume <session-id>
  ```
  With copy-to-clipboard button
- Worktree path display

**Auto-refresh**: Poll every 5s while issue is in progress.

**Verification**: Visual — all sections render, polling works.

---

### Task 12: Package.json and Makefile

**File: `package.json`** — Add scripts:
```json
"issue-poller": "bun run --tsconfig tsconfig.runner.json scripts/issue-poller.ts",
"issue-pipeline": "bun run --tsconfig tsconfig.runner.json scripts/issue-pipeline.ts"
```

**File: `Makefile`** — Add targets:
```makefile
issue-poller:
	bun run issue-poller
```

---

### Task 13: Systemd + Launchd Integration

**Linux (systemd)** — Add to `scripts/install.sh`:

Create `/etc/systemd/system/jarvis-issues.service`:
```ini
[Unit]
Description=Jarvis Issue Poller
After=jarvis.service

[Service]
Type=simple
WorkingDirectory=__INSTALL_DIR__
ExecStart=__BUN_PATH__ run --tsconfig tsconfig.runner.json scripts/issue-poller.ts
EnvironmentFile=/etc/jarvis/env
Restart=always
RestartSec=10
User=__USER__

[Install]
WantedBy=multi-user.target
```

Where `__BUN_PATH__` is resolved the same way as the existing `jarvis.service` (e.g., `$HOME/.bun/bin/bun` or the result of `which bun`).

**macOS (launchd)** — Add to `scripts/install.sh` macOS branch:

Create `~/Library/LaunchAgents/com.jarvis.issues.plist` following the pattern of the existing `com.jarvis.agent.plist`.

**File: `scripts/upgrade.sh`** — Add restart for the new service:
```bash
# Linux
sudo systemctl restart jarvis-issues || true
# macOS
launchctl kickstart -k gui/$(id -u)/com.jarvis.issues 2>/dev/null || true
```

---

### Task 14: Tests

**New file: `src/lib/issues/__tests__/telegram-poller.test.ts`**

```typescript
import { describe, test, expect } from "bun:test";
import { parseIssueMessage } from "../telegram-poller";

describe("parseIssueMessage", () => {
  test("parses valid /issue command", () => {
    const result = parseIssueMessage("/issue MyRepo: fix the login bug");
    expect(result).toEqual({ repoName: "MyRepo", description: "fix the login bug" });
  });

  test("parses with space separator instead of colon", () => {
    const result = parseIssueMessage("/issue MyRepo fix the login bug");
    expect(result).toEqual({ repoName: "MyRepo", description: "fix the login bug" });
  });

  test("parses multi-line description", () => {
    const result = parseIssueMessage("/issue MyRepo: fix the bug\nDetails: crashes on login");
    expect(result).toEqual({
      repoName: "MyRepo",
      description: "fix the bug\nDetails: crashes on login",
    });
  });

  test("returns null for non-issue messages", () => {
    expect(parseIssueMessage("hello")).toBeNull();
    expect(parseIssueMessage("/start")).toBeNull();
    expect(parseIssueMessage("")).toBeNull();
  });

  test("returns null for /issue without repo name", () => {
    expect(parseIssueMessage("/issue")).toBeNull();
  });
});
```

**New file: `src/lib/issues/__tests__/types.test.ts`**

```typescript
import { describe, test, expect } from "bun:test";
import { PHASE_STATUS_MAP, ISSUE_STATUSES } from "../types";

describe("PHASE_STATUS_MAP", () => {
  test("all phase statuses are valid IssueStatus values", () => {
    for (const status of Object.values(PHASE_STATUS_MAP)) {
      expect(ISSUE_STATUSES).toContain(status);
    }
  });

  test("covers phases 0-7", () => {
    for (let i = 0; i <= 7; i++) {
      expect(PHASE_STATUS_MAP[i]).toBeDefined();
    }
  });
});
```

**Verification**: `bun test`

---

### Task 15: CLAUDE.md Update

**File: `CLAUDE.md`** — Update the following sections:

1. **Architecture**: Add Issues pipeline diagram
2. **Project Structure**: Add new files under `src/lib/issues/`, `scripts/`, API routes, UI pages
3. **Database**: Add `repositories`, `issues`, `issue_messages` tables
4. **Environment Variables**: Note that Telegram issues bot is configured via UI (not env vars)
5. **Deployment**: Document `jarvis-issues.service` and the poller process

---

## Telegram Helper Export

**File: `src/lib/notifications/telegram.ts`** — Additional changes needed:

1. Export `TelegramConfig` type (currently private `interface`)
2. Export `escapeHtml` function (currently private, needed by telegram-poller.ts)
3. Add `sendTelegramMessageWithId` (Task 3)

---

## File Change Summary

### New Files (17)
1. `src/lib/issues/types.ts` — Types, constants, phase mapping
2. `src/lib/issues/telegram-poller.ts` — Telegram long-polling + message parsing
3. `src/lib/issues/pipeline.ts` — Multi-phase pipeline orchestrator
4. `src/lib/issues/__tests__/telegram-poller.test.ts` — Poller unit tests
5. `src/lib/issues/__tests__/types.test.ts` — Types unit tests
6. `src/lib/validations/repository.ts` — Zod schemas
7. `scripts/issue-poller.ts` — Background Telegram poller
8. `scripts/issue-pipeline.ts` — CLI to run pipeline for specific issue
9. `src/app/api/issues/projects/route.ts` — Repository CRUD
10. `src/app/api/issues/projects/[id]/route.ts` — Single repository
11. `src/app/api/issues/route.ts` — Issues list + create
12. `src/app/api/issues/[id]/route.ts` — Issue detail/update/delete
13. `src/app/api/issues/[id]/messages/route.ts` — Q&A thread
14. `src/app/api/issues/[id]/retry/route.ts` — Retry failed issue
15. `src/app/api/issues/telegram/route.ts` — Issues Telegram config
16. `src/app/(app)/issues/page.tsx` — Issues list page
17. `src/app/(app)/issues/config/page.tsx` — Repository + Telegram config
18. `src/app/(app)/issues/[id]/page.tsx` — Issue detail page

### Modified Files (6)
1. `src/lib/db/schema.ts` — Add 3 new tables
2. `src/lib/notifications/telegram.ts` — Export types, add `sendTelegramMessageWithId`
3. `src/components/layout/top-nav.tsx` — Add Issues tab
4. `package.json` — Add scripts
5. `Makefile` — Add targets
6. `CLAUDE.md` — Documentation update

### Generated Files
- `drizzle/XXXX-add-issue-tables.sql` — Auto-generated migration

---

## Implementation Order

```
Task 1 (Schema) → Task 2 (Types/Validation) → Task 3 (Telegram utils)
    ↓
Task 4 (Telegram Poller) → Task 5 (Pipeline)
    ↓
Task 7 (API Routes) → Task 8 (Nav) → Task 9-11 (UI Pages)
    ↓
Task 6 (Background Scripts) → Task 12 (Package.json) → Task 13 (Systemd)
    ↓
Task 14 (Tests) → Task 15 (CLAUDE.md)
```

Tasks 7-11 (API + UI) can be done in parallel with Tasks 4-5 (core pipeline).
