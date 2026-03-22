import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, issueMessages, repositories } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { getSetting, setSetting } from "@/lib/db/app-settings";
import { sendTelegramMessageWithId, sendTelegramMessage, escapeHtml } from "@/lib/notifications/telegram";
import type { IssuesTelegramConfig, PipelinePhaseResult, IssueStatus } from "./types";
import {
  PHASE_STATUS_MAP, MAX_PLAN_ITERATIONS, MAX_CODE_REVIEW_ITERATIONS,
  PHASE_TIMEOUT_MS, IMPL_TIMEOUT_MS, QA_TIMEOUT_MS,
} from "./types";

const MAX_FALLBACK_CHARS = 50_000;

/** Allowed env var prefixes/names for Claude CLI child processes. */
const ALLOWED_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "TMPDIR", "XDG_CONFIG_HOME",
  "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CLAUDE_CODE_API_KEY",
  "GH_TOKEN", "GITHUB_TOKEN",
]);

/** Build a minimal env for Claude CLI — only pass through what's needed. */
function buildClaudeEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env as unknown as NodeJS.ProcessEnv;
}

/** Build the default worktree directory path under `.claude/worktrees/`. */
export function buildWorktreePath(repoPath: string, slug: string, shortId: string): string {
  return join(repoPath, ".claude", "worktrees", `${slug}-${shortId}`);
}

// ── Resume capability check (appSettings-cached, globalThis for HMR) ──

const _g = globalThis as unknown as { _resumeCheckPromise?: Promise<boolean>; _resumeCheckAt?: number };
const RESUME_CHECK_IN_MEMORY_TTL = 60 * 60 * 1000; // 1 hour — re-check DB after this

async function isResumeSupported(): Promise<boolean> {
  // Clear stale in-memory cache so DB TTL takes effect for long-running processes
  if (_g._resumeCheckPromise && _g._resumeCheckAt && Date.now() - _g._resumeCheckAt > RESUME_CHECK_IN_MEMORY_TTL) {
    _g._resumeCheckPromise = undefined;
  }
  if (!_g._resumeCheckPromise) {
    _g._resumeCheckAt = Date.now();
    _g._resumeCheckPromise = doResumeCheck().catch((err) => {
      console.error("[pipeline] Resume check failed, will retry:", err);
      _g._resumeCheckPromise = undefined;
      return false;
    });
  }
  return _g._resumeCheckPromise;
}

async function doResumeCheck(): Promise<boolean> {
  // Check DB cache first (survives process restarts)
  const cached = getSetting("claude-resume-supported");
  const checkedAt = getSetting("claude-resume-checked-at");

  if (cached !== null && checkedAt) {
    const supported = cached === "true";
    const age = Date.now() - new Date(checkedAt).getTime();
    // Cache true for 7 days; cache false for only 1 hour (self-heals after transient failures)
    const ttl = supported ? 7 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    if (age < ttl) {
      console.log(`[pipeline] Resume capability cached: ${supported}`);
      return supported;
    }
  }

  console.log("[pipeline] Checking --resume capability...");

  // Run verification: create a session, then resume it
  const testId = crypto.randomUUID();
  const create = await runClaudePhase({
    workdir: "/tmp",
    prompt: "Reply with exactly: VERIFY_OK",
    timeoutMs: 30_000,
    sessionId: testId,
  });
  if (!create.success || !create.output.includes("VERIFY_OK")) {
    console.log("[pipeline] Resume check: create phase failed, marking unsupported");
    cacheResumeResult(false);
    return false;
  }

  const resume = await runClaudePhase({
    workdir: "/tmp",
    prompt: "Reply with exactly: RESUME_OK",
    timeoutMs: 30_000,
    resumeSessionId: testId,
  });
  const supported = resume.success && resume.output.includes("RESUME_OK");
  console.log(`[pipeline] Resume capability: ${supported}`);
  cacheResumeResult(supported);
  return supported;
}

function cacheResumeResult(supported: boolean) {
  setSetting("claude-resume-supported", String(supported));
  setSetting("claude-resume-checked-at", new Date().toISOString());
}

/**
 * Run a single Claude CLI phase.
 * Prompt is piped via stdin. Uses --session-id or --resume.
 * Parses stream-json output for result text.
 */
async function runClaudePhase(opts: {
  workdir: string;
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  sessionId?: string;
  resumeSessionId?: string;
}): Promise<PipelinePhaseResult> {
  // Compute once, use everywhere — no double-UUID risk
  const effectiveSessionId = opts.resumeSessionId || opts.sessionId || crypto.randomUUID();

  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  } else {
    args.push("--session-id", effectiveSessionId);
  }

  // System prompt only on creation (resumed sessions inherit it)
  if (opts.systemPrompt && !opts.resumeSessionId) {
    args.push("--append-system-prompt", opts.systemPrompt);
  }

  const timeout = opts.timeoutMs || PHASE_TIMEOUT_MS;

  return new Promise<PipelinePhaseResult>((resolve) => {
    const proc = spawn(resolveClaudePath(), args, {
      cwd: opts.workdir,
      env: buildClaudeEnv(),
    });

    proc.stdin!.write(opts.prompt);
    proc.stdin!.end();

    let buffer = "";
    let resultText = "";
    const assistantBlocks: string[] = [];
    let assistantBlocksSize = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      // Force kill if SIGTERM is ignored after 30s
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already dead */ } }, 30000);
    }, timeout);

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      // Cap buffer to prevent OOM from very long lines without newlines
      if (buffer.length > 1_000_000) {
        buffer = buffer.slice(-500_000);
      }
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
              if (block.type === "text" && block.text && assistantBlocksSize < MAX_FALLBACK_CHARS) {
                assistantBlocks.push(block.text);
                assistantBlocksSize += block.text.length;
              }
            }
          }
        } catch { /* skip non-JSON lines */ }
      }
    });

    let stderrOutput = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.length > 10000) stderrOutput = stderrOutput.slice(-10000);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === "result" && event.result) resultText = event.result;
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text && assistantBlocksSize < MAX_FALLBACK_CHARS) {
                assistantBlocks.push(block.text);
                assistantBlocksSize += block.text.length;
              }
            }
          }
        } catch { /* ignore */ }
      }

      // Cap resultText to prevent unbounded DB writes
      if (resultText.length > MAX_FALLBACK_CHARS) {
        resultText = resultText.substring(0, MAX_FALLBACK_CHARS);
      }

      let output = resultText.trim() || assistantBlocks.join("\n\n");
      if (timedOut) output = `[TIMEOUT after ${timeout / 1000}s] ${output}`;
      if (!output && stderrOutput) output = stderrOutput;

      const hasQuestions = /##\s*Questions/i.test(output);
      const questions = hasQuestions
        ? output.substring(output.search(/##\s*Questions/i))
        : undefined;

      resolve({
        success: code === 0 && !timedOut,
        output,
        sessionId: effectiveSessionId,
        hasQuestions,
        questions,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: err.message, sessionId: effectiveSessionId });
    });
  });
}

// ── Helper functions ──────────────────────────────────────────

async function updatePhase(issueId: string, phase: number, status: IssueStatus) {
  await db.update(issues).set({
    currentPhase: phase,
    status,
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));
}

async function failIssue(issueId: string, error: string) {
  await db.update(issues).set({
    status: "failed",
    error: error.substring(0, 10000),
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));
}

/** Check if the issue has been cancelled (status set to "failed" externally). */
async function isCancelled(issueId: string): Promise<boolean> {
  const [issue] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId));
  return issue?.status === "failed";
}

async function notify(config: IssuesTelegramConfig, text: string) {
  try {
    const truncated = text.length > 4096 ? text.substring(0, 4093) + "..." : text;
    await sendTelegramMessage(config, truncated);
  } catch (err) {
    console.error("Failed to send Telegram notification:", err);
  }
}

async function handleQuestions(
  issueId: string,
  questions: string,
  config: IssuesTelegramConfig
): Promise<boolean> {
  const truncatedQ = questions.length > 3800
    ? questions.substring(0, 3800) + "..."
    : questions;

  // Capture time BEFORE sending so we don't miss fast replies
  const questionTime = new Date();

  const msgId = await sendTelegramMessageWithId(config,
    `Questions for issue <code>${issueId.substring(0, 8)}</code>:\n\n${escapeHtml(truncatedQ)}\n\n<i>Reply to this message to answer.</i>`
  );

  await db.insert(issueMessages).values({
    issueId,
    direction: "from_claude",
    message: questions,
    telegramMessageId: msgId,
  });

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

async function getUserAnswers(issueId: string): Promise<string | null> {
  const messages = await db.select().from(issueMessages)
    .where(and(eq(issueMessages.issueId, issueId), eq(issueMessages.direction, "from_user")))
    .orderBy(issueMessages.createdAt);

  if (messages.length === 0) return null;
  return messages.map(m => m.message).join("\n\n");
}

/** Extract a PipelinePhaseResult from a settled promise, returning a failure result on rejection. */
function settledResult(r: PromiseSettledResult<PipelinePhaseResult>): PipelinePhaseResult {
  if (r.status === "fulfilled") return r.value;
  return { success: false, output: `Agent failed: ${String(r.reason)}` };
}

// ── Planning session helpers ─────────────────────────────────

/** Create a fresh planning session with a new UUID. Updates planningSessionId in DB. */
async function createFreshPlanningSession(
  workdir: string,
  prompt: string,
  issueId: string,
): Promise<{ result: PipelinePhaseResult; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const result = await runClaudePhase({
    workdir,
    prompt,
    systemPrompt: "You are an expert implementation planner. Create detailed, actionable plans.",
    timeoutMs: PHASE_TIMEOUT_MS,
    sessionId,
  });
  await db.update(issues).set({ planningSessionId: sessionId, updatedAt: new Date() })
    .where(eq(issues.id, issueId));
  return { result, sessionId };
}

/** Build a prompt for resumed planning sessions (only new context, no duplicate planning prompt). */
function buildResumePlanningPrompt(
  reviewFeedback: string | null | undefined,
  completenessReview: string | null | undefined,
  userAnswers: string | null,
): string {
  if (reviewFeedback) {
    return `Your previous plan was reviewed and found to have issues. Create a REVISED plan addressing all feedback below.

## Review Feedback
${reviewFeedback}
${completenessReview ? `\n## Completeness Review Feedback\n${completenessReview}` : ""}
${userAnswers ? `\n## User's Answers to Your Questions\n${userAnswers}` : ""}

Revise your implementation plan to address all the review feedback. Include the "## Codebase Analysis" section again.
End with "VERDICT: READY" or "## Questions" if you need more information.`;
  }
  if (userAnswers) {
    return `Here are the answers to your questions:

${userAnswers}

Please update your implementation plan based on these answers. Include the "## Codebase Analysis" section.
End with "VERDICT: READY" or "## Questions" if you need more information.`;
  }
  // Resuming after crash with no new context — ask to continue
  return `Continue your implementation plan where you left off. Include the "## Codebase Analysis" section.
End with "VERDICT: READY" or "## Questions" if you need more information.`;
}

/** Build a full planning prompt with all available context (for fresh sessions). */
function buildFullPlanningPrompt(
  description: string,
  planOutput: string,
  reviewFeedback: string | null | undefined,
  completenessReview: string | null | undefined,
  userAnswers: string | null,
): string {
  let prompt = buildPlanningPrompt(description);
  if (planOutput && reviewFeedback) {
    prompt += `\n\n## Previous Plan Review Feedback\n${reviewFeedback}`;
  }
  if (planOutput && completenessReview) {
    prompt += `\n\n## Completeness Review Feedback\n${completenessReview}`;
  }
  if (userAnswers) {
    prompt += `\n\n## User's Answers to Questions\n${userAnswers}`;
  }
  return prompt;
}

// ── Prompt builders ──────────────────────────────────────────

function buildPlanningPrompt(description: string): string {
  return `You are tasked with creating a detailed implementation plan for the following issue.

## Issue Description
${description}

## Instructions
1. Analyze the codebase to understand the existing architecture and patterns
2. Create a step-by-step implementation plan
3. Identify files that need to be created or modified
4. Note any potential risks or edge cases
5. If you have questions that would significantly affect the plan, add a "## Questions" section at the end

## Output Format
Provide a structured plan with:
- Overview of the approach
- Detailed steps with file paths
- Any new dependencies needed
- Testing strategy

**Important**: Include a "## Codebase Analysis" section with:
- Key file paths you examined and their purposes
- Relevant code patterns and conventions observed
- Critical code snippets that the implementer must reference
- Architecture notes (how components connect)

This analysis will be used by the implementation phase, so be thorough.

End with either:
- "VERDICT: READY" if the plan is complete
- "## Questions" section if you need clarification`;
}

function buildAdversarialReviewPrompt(plan: string): string {
  return `You are an adversarial plan reviewer. Your job is to find problems, not validate.

## Plan to Review
${plan}

## Instructions
Review this plan for:
1. Security vulnerabilities
2. Missing error handling
3. Race conditions or concurrency issues
4. Incorrect assumptions about the codebase
5. Missing steps or dependencies
6. Breaking changes

For each issue found, classify as:
- CRITICAL: Must be fixed before implementation
- WARNING: Should be addressed but not blocking

## Output Format
List each issue with its severity, description, and suggested fix.

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

function buildCompletenessReviewPrompt(plan: string): string {
  return `You are a completeness and feasibility reviewer.

## Plan
${plan}

## Instructions
Check the plan for:
1. Missing implementation steps
2. Incorrect assumptions about the existing code
3. Missing test coverage
4. Integration gaps
5. Deployment or migration concerns

For each gap found, classify as:
- MISSING_STEP: A required step is not in the plan
- WRONG_ASSUMPTION: The plan assumes something incorrect about the codebase

## Output Format
List each finding with classification and description.

End with:
- "VERDICT: PASS" if the plan is complete and feasible
- "VERDICT: FAIL" if there are blocking gaps`;
}

function buildPlanFixPrompt(plan: string, adversarialReview: string, completenessReview: string): string {
  return `You are an expert plan fixer. Your job is to surgically revise an implementation plan to address ALL findings from two independent reviewers.

## Current Plan
${plan}

## Adversarial Review Findings
${adversarialReview}

## Completeness Review Findings
${completenessReview}

## Instructions
1. Read EVERY finding from both reviewers — CRITICAL, WARNING, and NOTE severity
2. For each finding, make the MINIMUM change to the plan that fully addresses it
3. Do NOT rewrite the plan from scratch — preserve all parts that were not flagged
4. If a finding suggests a specific fix, incorporate it directly
5. If two findings conflict, prefer the safer/more correct approach
6. Ensure the revised plan is still coherent and self-consistent after all fixes

## Output Format
Output the COMPLETE revised plan (not just the diffs). The output must be a standalone, clean plan that can be handed directly to an implementer. Do NOT include a changelog or summary of what was changed — just output the revised plan.

End with "VERDICT: READY" to indicate the revised plan is complete.`;
}

function buildImplementationPrompt(plan: string, review1: string, review2: string): string {
  return `Implement the following plan. Follow it precisely, incorporating the review feedback.

## Implementation Plan
${plan}

## Review Feedback to Address
### Adversarial Review
${review1}

### Completeness Review
${review2}

## Instructions
1. Implement each step of the plan
2. Address all review feedback
3. Write tests for new functionality
4. Ensure all existing tests still pass
5. Commit your changes with clear commit messages

Do NOT create a PR — that will be done in a separate step.`;
}

// ── Specialist code review prompts (READ-ONLY) ──────────────

function buildBugsLogicReviewPrompt(defaultBranch: string): string {
  return `You are a specialist code reviewer focused on BUGS AND LOGIC ERRORS.
Your job is to FIND defects — do NOT modify any files.

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see all changes
2. Read every changed file in full for context
3. For each change, actively try to break it:
   - Logic errors, wrong conditions, inverted booleans, off-by-one
   - Null/undefined handling gaps
   - Race conditions and concurrency bugs
   - Missing error handling, swallowed errors
   - Boundary conditions (empty, zero, MAX_INT, very large inputs)
4. DO NOT modify any files. You are a READ-ONLY reviewer.

## Output Format
For each issue found:
- **Severity**: CRITICAL / WARNING / NOTE
- **File**: exact file path and line number
- **Bug**: What's wrong (be specific)
- **Proof**: Input or scenario that triggers the bug
- **Fix**: Suggested code change

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

function buildSecurityEdgeCasesReviewPrompt(defaultBranch: string): string {
  return `You are a specialist code reviewer focused on SECURITY AND EDGE CASES.
Your job is to FIND vulnerabilities — do NOT modify any files.

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see all changes
2. Read every changed file in full for context
3. Analyze from an attacker's perspective:
   - Injection (SQL, command, XSS, path traversal, SSRF)
   - Authentication/authorization bypasses
   - Sensitive data exposure in logs, errors, responses
   - Input validation gaps (malformed input, special chars, huge strings)
   - Denial of service vectors (regex DoS, unbounded queries)
   - Edge cases: empty inputs, concurrent requests, partial failures
4. DO NOT modify any files. You are a READ-ONLY reviewer.

## Output Format
For each issue found:
- **Severity**: CRITICAL / WARNING / NOTE
- **File**: exact file path and line number
- **Vulnerability**: What's the issue
- **Attack scenario**: How to exploit it
- **Fix**: Suggested remediation

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

function buildDesignPerformanceReviewPrompt(defaultBranch: string): string {
  return `You are a specialist code reviewer focused on DESIGN AND PERFORMANCE.
Your job is to FIND design issues — do NOT modify any files.

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see all changes
2. Read changed files and related files for context
3. Evaluate:
   - Violations of existing code patterns and conventions
   - Missing or inadequate test coverage
   - API design issues (breaking changes, inconsistent interfaces)
   - Performance problems (N+1 queries, unnecessary work, large allocations)
   - Code duplication or missing abstractions
   - Backwards compatibility concerns
4. DO NOT modify any files. You are a READ-ONLY reviewer.

## Output Format
For each issue found:
- **Severity**: CRITICAL / WARNING / NOTE
- **File**: exact file path and line number
- **Issue**: What's wrong
- **Impact**: Concrete consequence
- **Fix**: Suggested improvement

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

function buildCodeFixPrompt(
  defaultBranch: string,
  bugsReview: string,
  securityReview: string,
  designReview: string,
): string {
  return `Fix ALL issues identified by the code reviewers below.

## Review Findings

### Bugs & Logic Review
${bugsReview}

### Security & Edge Cases Review
${securityReview}

### Design & Performance Review
${designReview}

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see current changes
2. Fix every CRITICAL finding listed above
3. Fix WARNING findings where the fix is straightforward
4. Run tests after each fix to ensure no regressions
5. Commit your fixes with clear commit messages
6. Do NOT create a PR

End with:
- "VERDICT: FIXED" if all CRITICAL issues were addressed
- "VERDICT: PARTIAL" if some could not be fixed (explain why)`;
}

/** Verify worktree is clean after parallel read-only reviewers. Reset if dirty. */
function ensureWorktreeClean(worktreeDir: string): void {
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

function buildPrCreationPrompt(title: string, description: string, defaultBranch: string): string {
  return `Create a pull request for the changes on this branch.

## Issue Details
Title: ${title}
Description: ${description}

## Instructions
1. Push the current branch to the remote
2. Create a PR using \`gh pr create\` targeting ${defaultBranch}
3. Use a descriptive title based on the issue
4. Include a summary of changes in the PR body
5. Include the issue description for context

Output the PR URL when done.`;
}

// ── Main pipeline ─────────────────────────────────────────────

export async function runIssuePipeline(
  issueId: string,
  telegramConfig: IssuesTelegramConfig
): Promise<void> {
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
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: repo.localRepoPath, stdio: "ignore" });
  } catch {
    await failIssue(issueId, `Not a git repository: ${repo.localRepoPath}`);
    return;
  }

  // Pre-flight: verify gh CLI is available
  try {
    execFileSync("gh", ["auth", "status"], { cwd: repo.localRepoPath, stdio: "ignore" });
  } catch {
    await failIssue(issueId, "gh CLI not authenticated. Run: gh auth login");
    return;
  }

  // Create or reuse worktree
  const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 40);
  const shortId = issue.id.substring(0, 8);
  let branchName = issue.branchName || `issue/${slug}-${shortId}`;
  let worktreeDir = issue.worktreePath || buildWorktreePath(repo.localRepoPath, slug, shortId);

  // Skip worktree creation if it already exists (retry/resume scenario)
  if (!existsSync(worktreeDir)) {
    mkdirSync(join(repo.localRepoPath, ".claude", "worktrees"), { recursive: true });

    try {
      execFileSync("git", ["worktree", "add", worktreeDir, "-b", branchName, repo.defaultBranch], {
        cwd: repo.localRepoPath, stdio: "ignore",
      });
    } catch {
      try {
        execFileSync("git", ["worktree", "add", worktreeDir, branchName], {
          cwd: repo.localRepoPath, stdio: "ignore",
        });
      } catch (e) {
        await failIssue(issueId, `Failed to create worktree: ${e}`);
        return;
      }
    }
  }

  const phaseSessionIds: Record<string, string> = issue.phaseSessionIds as Record<string, string> || {};

  // Determine start phase (resume support)
  const startPhase = issue.currentPhase > 0 ? issue.currentPhase : 1;

  // Check if --resume is supported (cached in appSettings, globalThis for HMR)
  const resumeSupported = await isResumeSupported();

  // Living planning session: created in Phase 1 iter 1, resumed across iterations + Phase 4
  let planningSessionId = issue.planningSessionId || crypto.randomUUID();
  let isFirstPlanRun = !issue.planningSessionId; // true = --session-id (create), false = --resume

  // Defer planningSessionId write until after first successful phase (avoids stale UUID on early failure)
  await db.update(issues).set({
    worktreePath: worktreeDir,
    branchName,
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));

  try {
    // ── Phases 1-3: Planning + Reviews ─────────────────────
    // Guard covers phases 1-3 since they're part of the planning loop
    if (startPhase <= 3) {
      if (await isCancelled(issueId)) return;
      await updatePhase(issueId, 1, "planning");
      await notify(telegramConfig, `Planning started for: <b>${escapeHtml(issue.title)}</b>`);

      let planOutput = "";
      let planIterations = 0;
      let planApproved = false;
      let skipPlanning = false; // Set after plan-fix to go directly to re-review

      while (!planApproved && planIterations < MAX_PLAN_ITERATIONS) {
        if (!skipPlanning) {
          // Hoist DB queries above the branching logic (avoids duplication)
          const [currentIssue] = await db.select().from(issues).where(eq(issues.id, issueId));
          const userAnswers = await getUserAnswers(issueId);

          // Build the full prompt (used for fresh sessions and as fallback)
          const freshPrompt = buildFullPlanningPrompt(
            issue.description, planOutput, currentIssue?.planReview1, currentIssue?.planReview2, userAnswers,
          );

          // Run Phase 1 — create, resume, or fresh fallback
          let planResult: PipelinePhaseResult;

          if (isFirstPlanRun) {
            // CREATE the planning session
            planResult = await runClaudePhase({
              workdir: worktreeDir,
              prompt: freshPrompt,
              systemPrompt: "You are an expert implementation planner. Create detailed, actionable plans.",
              timeoutMs: PHASE_TIMEOUT_MS,
              sessionId: planningSessionId,
            });
            isFirstPlanRun = false;
          } else if (resumeSupported) {
            // RESUME the planning session (keeps exploration context!)
            const resumePrompt = buildResumePlanningPrompt(
              currentIssue?.planReview1, currentIssue?.planReview2, userAnswers,
            );
            planResult = await runClaudePhase({
              workdir: worktreeDir,
              prompt: resumePrompt,
              timeoutMs: PHASE_TIMEOUT_MS,
              resumeSessionId: planningSessionId,
            });

            // If resume failed (not timeout), fall back to fresh session with full context
            if (!planResult.success && !planResult.timedOut) {
              console.log("[pipeline] Planning resume failed, falling back to fresh session");
              const fresh = await createFreshPlanningSession(worktreeDir, freshPrompt, issueId);
              planResult = fresh.result;
              planningSessionId = fresh.sessionId;
            }
          } else {
            // Resume not supported — fresh session each iteration (current behavior)
            const fresh = await createFreshPlanningSession(worktreeDir, freshPrompt, issueId);
            planResult = fresh.result;
            planningSessionId = fresh.sessionId;
          }

          if (!planResult.success) {
            await failIssue(issueId, `Planning failed: ${planResult.output.substring(0, 2000)}`);
            return;
          }

          // Store iteration-indexed session IDs (keep "1" pointing to latest for CLI resume)
          const planIterKey = planIterations > 0 ? `.${planIterations + 1}` : "";
          if (planResult.sessionId) phaseSessionIds[`1${planIterKey}`] = planResult.sessionId;
          phaseSessionIds["1"] = planResult.sessionId!;
          planOutput = planResult.output;
          await db.update(issues).set({
            planOutput,
            planningSessionId,
            phaseSessionIds,
            updatedAt: new Date(),
          }).where(eq(issues.id, issueId));

          // Handle questions
          if (planResult.hasQuestions && planResult.questions) {
            const answered = await handleQuestions(issueId, planResult.questions, telegramConfig);
            if (!answered) {
              await failIssue(issueId, "Timed out waiting for user reply to questions");
              return;
            }
            continue;
          }
        } else {
          skipPlanning = false;
        }

        // Count this as a plan iteration (questions don't consume iterations)
        planIterations++;

        // ── Phase 2: Plan Verification (2 reviewers in parallel) ──
        if (await isCancelled(issueId)) return;
        await updatePhase(issueId, 2, "reviewing_plan_1");
        await notify(telegramConfig, `Plan verification started (2 reviewers in parallel)`);

        const planReviewResults = await Promise.allSettled([
          runClaudePhase({
            workdir: worktreeDir,
            prompt: buildAdversarialReviewPrompt(planOutput),
            systemPrompt: "You are an adversarial plan reviewer. Find problems, not validate.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
          runClaudePhase({
            workdir: worktreeDir,
            prompt: buildCompletenessReviewPrompt(planOutput),
            systemPrompt: "You are a completeness and feasibility reviewer. Find gaps.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
        ]);
        const review1Result = settledResult(planReviewResults[0]);
        const review2Result = settledResult(planReviewResults[1]);

        // Store iteration-indexed review session IDs (keep "2"/"3" pointing to latest for CLI resume)
        const reviewIterKey = planIterations > 1 ? `.${planIterations}` : "";
        if (review1Result.sessionId) phaseSessionIds[`2${reviewIterKey}`] = review1Result.sessionId;
        if (review2Result.sessionId) phaseSessionIds[`3${reviewIterKey}`] = review2Result.sessionId;
        if (review1Result.sessionId) phaseSessionIds["2"] = review1Result.sessionId;
        if (review2Result.sessionId) phaseSessionIds["3"] = review2Result.sessionId;
        await db.update(issues).set({
          planReview1: review1Result.output,
          planReview2: review2Result.output,
          phaseSessionIds,
          updatedAt: new Date(),
        }).where(eq(issues.id, issueId));

        // Check if EITHER reviewer found CRITICAL issues (VERDICT: FAIL)
        const review1Failed = /VERDICT:\s*FAIL/i.test(review1Result.output);
        const review2Failed = /VERDICT:\s*FAIL/i.test(review2Result.output);

        if (review1Failed || review2Failed) {
          if (planIterations >= MAX_PLAN_ITERATIONS) break;
          if (await isCancelled(issueId)) return;

          // ── Plan Fix: surgically address review findings ──
          await notify(telegramConfig,
            `Plan review round ${planIterations} failed. Fixing plan before attempt ${planIterations + 1}...`
          );

          const capPerInput = Math.floor(MAX_FALLBACK_CHARS / 3) - 500;
          const fixPrompt = buildPlanFixPrompt(
            planOutput.substring(0, capPerInput),
            review1Result.output.substring(0, capPerInput),
            review2Result.output.substring(0, capPerInput),
          );
          let fixResult: PipelinePhaseResult;

          if (resumeSupported && planningSessionId) {
            // Resume the planning session with fix instructions (preserves exploration context)
            fixResult = await runClaudePhase({
              workdir: worktreeDir,
              prompt: fixPrompt,
              timeoutMs: PHASE_TIMEOUT_MS,
              resumeSessionId: planningSessionId,
            });

            // Fallback to fresh session if resume fails
            if (!fixResult.success && !fixResult.timedOut) {
              console.log("[pipeline] Plan fix resume failed, falling back to fresh session");
              fixResult = await runClaudePhase({
                workdir: worktreeDir,
                prompt: fixPrompt,
                systemPrompt: "You are an expert plan fixer. Surgically revise the plan to address all review findings.",
                timeoutMs: PHASE_TIMEOUT_MS,
              });
              // Keep planningSessionId in sync so subsequent resumes don't hit a stale session
              if (fixResult.sessionId) {
                planningSessionId = fixResult.sessionId;
                await db.update(issues).set({ planningSessionId, updatedAt: new Date() })
                  .where(eq(issues.id, issueId));
              }
            }
          } else {
            fixResult = await runClaudePhase({
              workdir: worktreeDir,
              prompt: fixPrompt,
              systemPrompt: "You are an expert plan fixer. Surgically revise the plan to address all review findings.",
              timeoutMs: PHASE_TIMEOUT_MS,
            });
            if (fixResult.sessionId) {
              planningSessionId = fixResult.sessionId;
              await db.update(issues).set({ planningSessionId, updatedAt: new Date() })
                .where(eq(issues.id, issueId));
            }
          }

          if (fixResult.success && fixResult.output.trim()) {
            // Only accept if the fix agent signals completion; strip verdict marker
            if (/VERDICT:\s*READY/i.test(fixResult.output)) {
              planOutput = fixResult.output
                .replace(/\n*VERDICT:\s*READY[^\n]*/gi, "")
                .trim();
              await db.update(issues).set({
                planOutput,
                updatedAt: new Date(),
              }).where(eq(issues.id, issueId));
            } else {
              console.warn("[pipeline] Plan fix did not include VERDICT: READY, keeping original plan");
            }
          } else {
            console.warn(`[pipeline] Plan fix failed (success=${fixResult.success}). Retrying with original plan.`);
          }

          skipPlanning = true;
          continue;
        }

        planApproved = true;
      }

      if (!planApproved) {
        await failIssue(issueId, `Plan could not pass review after ${MAX_PLAN_ITERATIONS} attempts`);
        await notify(telegramConfig, `Planning failed after ${MAX_PLAN_ITERATIONS} attempts for: ${escapeHtml(issue.title)}`);
        return;
      }

      await notify(telegramConfig, `Plan approved. Starting implementation...`);
    }

    // ── Phase 4: Implementation (resume planning session if possible) ──
    if (startPhase <= 4) {
      if (await isCancelled(issueId)) return;
      await updatePhase(issueId, 4, "implementing");

      const [currentIssue] = await db.select().from(issues).where(eq(issues.id, issueId));
      let implPrompt = buildImplementationPrompt(
        currentIssue?.planOutput || "",
        currentIssue?.planReview1 || "",
        currentIssue?.planReview2 || ""
      );
      const userAnswers = await getUserAnswers(issueId);
      if (userAnswers) {
        implPrompt += `\n\n## Additional Context from User\n${userAnswers}`;
      }

      // Resume the planning session if the session exists and --resume is supported.
      // Safe even on crash-resume: if resume fails, the fallback handles it below.
      const canResume = (
        startPhase <= 4 &&
        currentIssue?.planningSessionId &&
        resumeSupported
      );

      let implResult: PipelinePhaseResult;

      if (canResume) {
        implResult = await runClaudePhase({
          workdir: worktreeDir,
          prompt: implPrompt,
          timeoutMs: IMPL_TIMEOUT_MS,
          resumeSessionId: currentIssue!.planningSessionId!,
        });

        // If resume failed (not timeout), retry with fresh session
        if (!implResult.success && !implResult.timedOut) {
          console.log("[pipeline] Implementation resume failed, retrying with fresh session");
          implResult = await runClaudePhase({
            workdir: worktreeDir,
            prompt: implPrompt,
            systemPrompt: "You are an expert software engineer. Implement the plan precisely.",
            timeoutMs: IMPL_TIMEOUT_MS,
          });
        }
      } else {
        // Fresh session (crash recovery, retry, or resume not supported)
        implResult = await runClaudePhase({
          workdir: worktreeDir,
          prompt: implPrompt,
          systemPrompt: "You are an expert software engineer. Implement the plan precisely.",
          timeoutMs: IMPL_TIMEOUT_MS,
        });
      }

      if (!implResult.success) {
        await failIssue(issueId, `Implementation failed: ${implResult.output.substring(0, 2000)}`);
        return;
      }

      phaseSessionIds["4"] = implResult.sessionId!;
      await db.update(issues).set({ phaseSessionIds, updatedAt: new Date() }).where(eq(issues.id, issueId));
      await notify(telegramConfig, `Implementation complete. Starting code review...`);
    }

    // ── Phases 5-6: Adversarial Code Review + Auto-Fix Loop ──
    if (startPhase <= 6) {
      let codeApproved = false;
      let crIterations = 0;

      while (!codeApproved && crIterations < MAX_CODE_REVIEW_ITERATIONS) {
        crIterations++;

        // ── Phase 5: 3 specialist reviewers in parallel (READ-ONLY) ──
        if (await isCancelled(issueId)) return;
        await updatePhase(issueId, 5, "reviewing_code_1");
        await notify(telegramConfig,
          `Code review round ${crIterations}/${MAX_CODE_REVIEW_ITERATIONS} (3 specialist reviewers)`
        );

        const codeReviewResults = await Promise.allSettled([
          runClaudePhase({
            workdir: worktreeDir,
            prompt: buildBugsLogicReviewPrompt(repo.defaultBranch),
            systemPrompt: "You are a bugs & logic reviewer. DO NOT modify files.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
          runClaudePhase({
            workdir: worktreeDir,
            prompt: buildSecurityEdgeCasesReviewPrompt(repo.defaultBranch),
            systemPrompt: "You are a security reviewer. DO NOT modify files.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
          runClaudePhase({
            workdir: worktreeDir,
            prompt: buildDesignPerformanceReviewPrompt(repo.defaultBranch),
            systemPrompt: "You are a design & performance reviewer. DO NOT modify files.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
        ]);
        const bugsResult = settledResult(codeReviewResults[0]);
        const securityResult = settledResult(codeReviewResults[1]);
        const designResult = settledResult(codeReviewResults[2]);

        // Verify reviewers didn't modify the worktree
        ensureWorktreeClean(worktreeDir);

        // Combine reviews with per-reviewer caps to stay under MAX_FALLBACK_CHARS
        const capPerReviewer = Math.floor(MAX_FALLBACK_CHARS / 3) - 200;
        const roundReview = [
          `# Code Review Round ${crIterations}`,
          "## Bugs & Logic Review\n" + bugsResult.output.substring(0, capPerReviewer),
          "## Security & Edge Cases Review\n" + securityResult.output.substring(0, capPerReviewer),
          "## Design & Performance Review\n" + designResult.output.substring(0, capPerReviewer),
        ].join("\n\n---\n\n");

        // Accumulate reviews across iterations (don't overwrite prior rounds)
        const [prevIssue] = await db.select({ cr1: issues.codeReview1 }).from(issues).where(eq(issues.id, issueId));
        const accumulatedReview = crIterations === 1
          ? roundReview
          : ((prevIssue?.cr1 || "") + "\n\n========================================\n\n" + roundReview).substring(0, MAX_FALLBACK_CHARS);

        // Store all 3 reviewer session IDs with iteration indexing
        const crIterKey = crIterations > 1 ? `.${crIterations}` : "";
        if (bugsResult.sessionId) phaseSessionIds[`5a${crIterKey}`] = bugsResult.sessionId;
        if (securityResult.sessionId) phaseSessionIds[`5b${crIterKey}`] = securityResult.sessionId;
        if (designResult.sessionId) phaseSessionIds[`5c${crIterKey}`] = designResult.sessionId;
        // Keep "5" pointing to latest for CLI resume
        if (bugsResult.sessionId) phaseSessionIds["5"] = bugsResult.sessionId;
        await db.update(issues).set({
          codeReview1: accumulatedReview,
          phaseSessionIds,
          updatedAt: new Date(),
        }).where(eq(issues.id, issueId));

        // Check if all reviewers passed
        const anyFailed = [bugsResult, securityResult, designResult].some(
          r => /VERDICT:\s*FAIL/i.test(r.output)
        );

        if (!anyFailed) {
          codeApproved = true;
          await notify(telegramConfig, `All code reviews passed!`);
          break;
        }

        if (crIterations >= MAX_CODE_REVIEW_ITERATIONS) break;

        // ── Phase 6: Auto-fix all issues ──
        if (await isCancelled(issueId)) return;
        await updatePhase(issueId, 6, "reviewing_code_2");
        await notify(telegramConfig,
          `Fixing code review findings (round ${crIterations}/${MAX_CODE_REVIEW_ITERATIONS})...`
        );

        // Track HEAD before fix for convergence detection
        let headBefore = "";
        try {
          headBefore = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: worktreeDir, encoding: "utf-8",
          }).trim();
        } catch { /* ignore */ }

        const fixResult = await runClaudePhase({
          workdir: worktreeDir,
          prompt: buildCodeFixPrompt(
            repo.defaultBranch,
            bugsResult.output,
            securityResult.output,
            designResult.output,
          ),
          systemPrompt: "You are an expert software engineer. Fix all identified issues.",
          timeoutMs: IMPL_TIMEOUT_MS,
        });

        // Accumulate fix outputs across iterations
        const [prevFix] = await db.select({ cr2: issues.codeReview2 }).from(issues).where(eq(issues.id, issueId));
        const fixOutput = `# Fix Round ${crIterations}\n${fixResult.output}`;
        const accumulatedFixes = crIterations === 1
          ? fixOutput
          : ((prevFix?.cr2 || "") + "\n\n========================================\n\n" + fixOutput).substring(0, MAX_FALLBACK_CHARS);

        // Store iteration-indexed fix session IDs
        const fixIterKey = crIterations > 1 ? `.${crIterations}` : "";
        if (fixResult.sessionId) phaseSessionIds[`6${fixIterKey}`] = fixResult.sessionId;
        // Keep "6" pointing to latest for CLI resume
        if (fixResult.sessionId) phaseSessionIds["6"] = fixResult.sessionId;
        await db.update(issues).set({
          codeReview2: accumulatedFixes,
          phaseSessionIds,
          updatedAt: new Date(),
        }).where(eq(issues.id, issueId));

        if (!fixResult.success) {
          await failIssue(issueId, `Code fix failed: ${fixResult.output.substring(0, 2000)}`);
          return;
        }

        // Convergence check: if fix agent made no commits, loop won't converge
        try {
          const headAfter = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: worktreeDir, encoding: "utf-8",
          }).trim();
          if (headBefore && headBefore === headAfter) {
            await notify(telegramConfig, `Fix agent made no changes. Stopping review loop.`);
            break;
          }
        } catch { /* ignore */ }

        await notify(telegramConfig, `Fixes applied. Re-reviewing...`);
      }

      if (!codeApproved) {
        await notify(telegramConfig,
          `Code review reached max iterations (${MAX_CODE_REVIEW_ITERATIONS}). Proceeding to PR.`
        );
      }
    }

    // ── Phase 7: PR Creation ───────────────────────────────
    if (startPhase <= 7) {
      if (await isCancelled(issueId)) return;
      await updatePhase(issueId, 7, "creating_pr");

      const prResult = await runClaudePhase({
        workdir: worktreeDir,
        prompt: buildPrCreationPrompt(issue.title, issue.description, repo.defaultBranch),
        systemPrompt: "Create a pull request using the gh CLI.",
        timeoutMs: PHASE_TIMEOUT_MS,
      });

      if (!prResult.success) {
        await failIssue(issueId, `PR creation failed: ${prResult.output.substring(0, 2000)}`);
        return;
      }

      const prUrlMatch = prResult.output.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
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
        `Issue completed: <b>${escapeHtml(issue.title)}</b>\n` +
        (prUrl ? `PR: ${prUrl}` : "PR created (check issue detail for link)")
      );
    }

  } catch (err) {
    await failIssue(issueId, String(err));
    await notify(telegramConfig, `Pipeline failed for: ${escapeHtml(issue.title)}\nError: ${escapeHtml(String(err).substring(0, 200))}`);
  }
}
