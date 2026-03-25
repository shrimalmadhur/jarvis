import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, issueMessages, repositories } from "@/lib/db/schema";
import { getIssueAttachments } from "./attachments";
import { eq, and, gt } from "drizzle-orm";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { getSetting, setSetting } from "@/lib/db/app-settings";
import { sendTelegramMessageWithId, sendTelegramMessage, escapeHtml, TELEGRAM_SAFE_MSG_LEN } from "@/lib/notifications/telegram";
import type { IssuesTelegramConfig, PipelinePhaseResult, IssueStatus } from "./types";
import {
  PHASE_STATUS_MAP, MAX_PLAN_ITERATIONS, MAX_CODE_REVIEW_ITERATIONS,
  PHASE_TIMEOUT_MS, IMPL_TIMEOUT_MS, QA_TIMEOUT_MS,
} from "./types";

const MAX_FALLBACK_CHARS = 50_000;

/** Files that should never be auto-committed. Tested against full path from git status. */
const SENSITIVE_FILE_PATTERN =
  /\.(env|pem|key|p12|pfx|jks|keystore)(\..*)?$|\.npmrc$|\.pypirc$|id_(rsa|ed25519|ecdsa|dsa)$|credentials\.json$/i;

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
  const truncatedQ = questions.length > TELEGRAM_SAFE_MSG_LEN
    ? questions.substring(0, TELEGRAM_SAFE_MSG_LEN) + "..."
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
  attachmentPaths: string[] = [],
): string {
  const attachmentReminder = attachmentPaths.length > 0
    ? `\n\n## Attached Images (still available)\nUse the Read tool to view these images for visual context:\n${attachmentPaths.map(p => `- ${p}`).join("\n")}\n`
    : "";

  if (reviewFeedback) {
    return `Your previous plan was reviewed and found to have issues. Create a REVISED plan addressing all feedback below.

## Review Feedback
${reviewFeedback}
${completenessReview ? `\n## Completeness Review Feedback\n${completenessReview}` : ""}
${userAnswers ? `\n## User's Answers to Your Questions\n${userAnswers}` : ""}
${attachmentReminder}
Revise your implementation plan to address all the review feedback. Include the "## Codebase Analysis" section again.
End with "VERDICT: READY" or "## Questions" if you need more information.`;
  }
  if (userAnswers) {
    return `Here are the answers to your questions:

${userAnswers}
${attachmentReminder}
Please update your implementation plan based on these answers. Include the "## Codebase Analysis" section.
End with "VERDICT: READY" or "## Questions" if you need more information.`;
  }
  // Resuming after crash with no new context — ask to continue
  return `Continue your implementation plan where you left off. Include the "## Codebase Analysis" section.
${attachmentReminder}
End with "VERDICT: READY" or "## Questions" if you need more information.`;
}

/** Build a full planning prompt with all available context (for fresh sessions). */
function buildFullPlanningPrompt(
  description: string,
  planOutput: string,
  reviewFeedback: string | null | undefined,
  completenessReview: string | null | undefined,
  userAnswers: string | null,
  attachmentPaths: string[] = [],
): string {
  let prompt = buildPlanningPrompt(description, attachmentPaths);
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

function buildPlanningPrompt(description: string, attachmentPaths: string[] = []): string {
  const attachmentSection = attachmentPaths.length > 0
    ? `\n\n## Attached Images\nThe following images were provided with this issue. Use the Read tool to view them for visual context:\n${attachmentPaths.map(p => `- ${p}`).join("\n")}`
    : "";

  return `You are tasked with creating a detailed implementation plan for the following issue.

## Issue Description
${description}
${attachmentSection}

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

function buildAdversarialReviewPrompt(plan: string, priorFindings?: string): string {
  const priorSection = priorFindings ? `
## Prior Review Findings (from previous rounds)
The following CRITICAL issues were found in earlier review rounds. You MUST verify that EACH of these has been addressed in the current plan. If any remain unaddressed, re-list them as CRITICAL.

${priorFindings}

` : "";

  return `You are an adversarial plan reviewer. Your job is to find problems, not validate.

## Plan to Review
${plan}
${priorSection}
## Instructions
Review this plan for:
1. Security vulnerabilities
2. Missing error handling
3. Race conditions or concurrency issues
4. Incorrect assumptions about the codebase
5. Missing steps or dependencies
6. Breaking changes
${priorFindings ? "7. Verify ALL prior findings listed above have been addressed" : ""}

For each issue found, classify as:
- CRITICAL: Must be fixed before implementation
- WARNING: Should be addressed but not blocking

## Output Format
List each issue with its severity, description, and suggested fix.

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

function buildCompletenessReviewPrompt(plan: string, priorFindings?: string): string {
  const priorSection = priorFindings ? `
## Prior Review Findings (from previous rounds)
The following issues were found in earlier review rounds. You MUST verify that EACH of these has been addressed in the current plan. If any remain unaddressed, re-list them as blocking gaps.

${priorFindings}

` : "";

  return `You are a completeness and feasibility reviewer.

## Plan
${plan}
${priorSection}
## Instructions
Check the plan for:
1. Missing implementation steps
2. Incorrect assumptions about the existing code
3. Missing test coverage
4. Integration gaps
5. Deployment or migration concerns
${priorFindings ? "6. Verify ALL prior findings listed above have been addressed" : ""}

For each gap found, classify as:
- MISSING_STEP: A required step is not in the plan
- WRONG_ASSUMPTION: The plan assumes something incorrect about the codebase

## Output Format
List each finding with classification and description.

End with:
- "VERDICT: PASS" if the plan is complete and feasible
- "VERDICT: FAIL" if there are blocking gaps`;
}

function buildPlanFixPrompt(plan: string, adversarialReview: string, completenessReview: string, priorFindings?: string): string {
  const priorSection = priorFindings ? `
## Previously Identified Issues (from earlier rounds)
These issues were found in earlier review rounds. Ensure they are ALSO addressed in your revision, not just the latest findings.

${priorFindings}
` : "";

  return `You are an expert plan fixer. Your job is to surgically revise an implementation plan to address ALL findings from two independent reviewers.

## Current Plan
${plan}

## Adversarial Review Findings
${adversarialReview}

## Completeness Review Findings
${completenessReview}
${priorSection}
## Instructions
1. Read EVERY finding from both reviewers — CRITICAL, WARNING, and NOTE severity
2. For each finding, make a concrete change to the plan that fully addresses it
3. Do NOT rewrite the plan from scratch — preserve all parts that were not flagged
4. If a finding suggests a specific fix, incorporate it directly
5. If two findings conflict, prefer the safer/more correct approach
6. Ensure the revised plan is still coherent and self-consistent after all fixes
${priorFindings ? "7. Also verify that ALL previously identified issues (listed above) remain addressed" : ""}

## Output Format
Output the COMPLETE revised plan (not just the diffs). The output must be a standalone, clean plan that can be handed directly to an implementer. Do NOT include a changelog, commentary, or summary of what was changed — just output the revised plan text and nothing else.`;
}

function buildImplementationPrompt(plan: string, review1: string, review2: string, attachmentPaths: string[] = []): string {
  const attachmentSection = attachmentPaths.length > 0
    ? `\n\n## Attached Images\nUse the Read tool to view these images for visual context:\n${attachmentPaths.map(p => `- ${p}`).join("\n")}`
    : "";

  return `Implement the following plan. Follow it precisely, incorporating the review feedback.

## Implementation Plan
${plan}

## Review Feedback to Address
### Adversarial Review
${review1}

### Completeness Review
${review2}
${attachmentSection}

## Instructions
1. Implement each step of the plan
2. Address all review feedback
3. Write tests for new functionality
4. Ensure all existing tests still pass
5. CRITICAL: You MUST commit all changes before finishing. Run \`git add -A && git commit -m "feat: <description>"\`. Uncommitted changes will be lost.

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
5. CRITICAL: You MUST commit all fixes before finishing. Run \`git add -A && git commit -m "fix: <description>"\`. Uncommitted changes will be lost.
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

/**
 * Auto-commit any uncommitted changes left behind by a phase.
 * Prevents ensureWorktreeClean() from wiping real implementation work.
 * Returns true if an auto-commit was created, false if worktree was already clean.
 */
function autoCommitUncommittedChanges(worktreeDir: string, commitMessage: string): boolean {
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
function hasBranchCommits(worktreeDir: string, baseBranch: string): boolean {
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

function buildPrCreationPrompt(title: string, description: string, defaultBranch: string, attachmentPaths: string[] = []): string {
  const attachmentSection = attachmentPaths.length > 0
    ? `\n\n## Attached Images\nUse the Read tool to view these images for visual context when writing the PR description:\n${attachmentPaths.map(p => `- ${p}`).join("\n")}`
    : "";

  return `Create a pull request for the changes on this branch.

## Issue Details
Title: ${title}
Description: ${description}
${attachmentSection}

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
      const priorPlanFindings: string[] = []; // Accumulated findings from previous review rounds

      while (!planApproved && planIterations < MAX_PLAN_ITERATIONS) {
        if (!skipPlanning) {
          // Hoist DB queries above the branching logic (avoids duplication)
          const [currentIssue] = await db.select().from(issues).where(eq(issues.id, issueId));
          const userAnswers = await getUserAnswers(issueId);
          // Re-query attachments each iteration (user may add photos via Q&A replies)
          const attachments = await getIssueAttachments(issueId);
          const attachmentPaths = attachments.map(a => a.filePath);

          // Build the full prompt (used for fresh sessions and as fallback)
          const freshPrompt = buildFullPlanningPrompt(
            issue.description, planOutput, currentIssue?.planReview1, currentIssue?.planReview2, userAnswers, attachmentPaths,
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
              currentIssue?.planReview1, currentIssue?.planReview2, userAnswers, attachmentPaths,
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

        const priorFindingsText = priorPlanFindings.length > 0
          ? priorPlanFindings.join("\n\n========================================\n\n")
              .substring(0, MAX_FALLBACK_CHARS)
          : undefined;

        const planReviewResults = await Promise.allSettled([
          runClaudePhase({
            workdir: worktreeDir,
            prompt: buildAdversarialReviewPrompt(planOutput, priorFindingsText),
            systemPrompt: "You are an adversarial plan reviewer. Find problems, not validate.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
          runClaudePhase({
            workdir: worktreeDir,
            prompt: buildCompletenessReviewPrompt(planOutput, priorFindingsText),
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
        // Accumulate reviews across iterations (prefix with round number for context)
        const roundReview1 = planIterations > 1
          ? `# Plan Review Round ${planIterations} - Adversarial\n${review1Result.output}`
          : review1Result.output;
        const roundReview2 = planIterations > 1
          ? `# Plan Review Round ${planIterations} - Completeness\n${review2Result.output}`
          : review2Result.output;

        const [prevIssue] = await db.select({
          pr1: issues.planReview1,
          pr2: issues.planReview2,
        }).from(issues).where(eq(issues.id, issueId));

        // Newest round first so truncation drops stale rounds, not the latest
        const accumulatedReview1 = planIterations === 1
          ? roundReview1
          : (roundReview1 + "\n\n========================================\n\n" + (prevIssue?.pr1 || ""))
              .substring(0, MAX_FALLBACK_CHARS);
        const accumulatedReview2 = planIterations === 1
          ? roundReview2
          : (roundReview2 + "\n\n========================================\n\n" + (prevIssue?.pr2 || ""))
              .substring(0, MAX_FALLBACK_CHARS);

        await db.update(issues).set({
          planReview1: accumulatedReview1,
          planReview2: accumulatedReview2,
          phaseSessionIds,
          updatedAt: new Date(),
        }).where(eq(issues.id, issueId));

        // Check if EITHER reviewer found CRITICAL issues (VERDICT: FAIL)
        const review1Failed = /VERDICT:\s*FAIL/i.test(review1Result.output);
        const review2Failed = /VERDICT:\s*FAIL/i.test(review2Result.output);

        if (review1Failed || review2Failed) {
          // Accumulate findings for subsequent review rounds
          const roundFindings = [
            review1Failed ? `### Round ${planIterations} - Adversarial Review CRITICALs\n${review1Result.output}` : "",
            review2Failed ? `### Round ${planIterations} - Completeness Review CRITICALs\n${review2Result.output}` : "",
          ].filter(Boolean).join("\n\n");
          priorPlanFindings.push(roundFindings);

          if (planIterations >= MAX_PLAN_ITERATIONS) break;
          if (await isCancelled(issueId)) return;

          // ── Plan Fix: surgically address review findings ──
          await notify(telegramConfig,
            `Plan review round ${planIterations} failed. Fixing plan before attempt ${planIterations + 1}...`
          );

          const priorFindingsForFix = priorPlanFindings.length > 1
            ? priorPlanFindings.slice(0, -1).join("\n\n")
            : undefined;
          const capPerInput = Math.floor(MAX_FALLBACK_CHARS / (priorFindingsForFix ? 4 : 3)) - 500;
          const fixPrompt = buildPlanFixPrompt(
            planOutput.substring(0, capPerInput),
            review1Result.output.substring(0, capPerInput),
            review2Result.output.substring(0, capPerInput),
            priorFindingsForFix?.substring(0, capPerInput),
          );

          // Always use a fresh session for fixes — resumed sessions respond
          // conversationally and fail to produce structured plan output
          const fixResult = await runClaudePhase({
            workdir: worktreeDir,
            prompt: fixPrompt,
            systemPrompt: "You are an expert plan fixer. Surgically revise the plan to address all review findings. Output ONLY the complete revised plan text with no commentary.",
            timeoutMs: PHASE_TIMEOUT_MS,
          });

          // Store fix session ID for debugging
          if (fixResult.sessionId) {
            phaseSessionIds[`fix.${planIterations}`] = fixResult.sessionId;
            await db.update(issues).set({ phaseSessionIds, updatedAt: new Date() })
              .where(eq(issues.id, issueId));
          }
          console.log(`[pipeline] Plan fix iteration ${planIterations} (session ${fixResult.sessionId}): success=${fixResult.success}, output=${fixResult.output.length} chars`);

          if (fixResult.success && fixResult.output.trim()) {
            // Accept the fix output as the new plan — the next review round is the quality gate
            planOutput = fixResult.output
              .replace(/\n*VERDICT:\s*(READY|PASS|FAIL)[^\n]*/gi, "")
              .trim();
            await db.update(issues).set({
              planOutput,
              updatedAt: new Date(),
            }).where(eq(issues.id, issueId));
            console.log(`[pipeline] Plan updated from fix (iteration ${planIterations}), ${planOutput.length} chars`);
            skipPlanning = true; // Skip planning, go straight to re-review
          } else {
            console.warn(`[pipeline] Plan fix failed (success=${fixResult.success}). Falling back to re-planning.`);
            // Don't set skipPlanning — let the next iteration re-run planning with review feedback
          }

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
      // Re-query attachments (user may have added photos via Q&A replies since planning)
      const implAttachments = await getIssueAttachments(issueId);
      const implAttachmentPaths = implAttachments.map(a => a.filePath);
      let implPrompt = buildImplementationPrompt(
        currentIssue?.planOutput || "",
        currentIssue?.planReview1 || "",
        currentIssue?.planReview2 || "",
        implAttachmentPaths,
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

      // ── Commit gate: ensure implementation actually committed ──
      autoCommitUncommittedChanges(worktreeDir,
        "feat: implement changes\n\nAuto-committed by pipeline — implementation phase did not commit.");
      if (!hasBranchCommits(worktreeDir, repo.defaultBranch)) {
        await failIssue(issueId, "Implementation produced no changes — no commits found beyond base branch.");
        return;
      }

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

        // Convergence check: did the fix agent make any commits?
        // Must run BEFORE auto-commit so we measure the agent's own progress.
        try {
          const headAfter = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: worktreeDir, encoding: "utf-8",
          }).trim();
          if (headBefore && headBefore === headAfter) {
            // Auto-commit any leftover changes before breaking, so they aren't lost
            autoCommitUncommittedChanges(worktreeDir,
              "fix: address code review findings\n\nAuto-committed by pipeline — fix phase did not commit.");
            await notify(telegramConfig, `Fix agent made no new commits. Stopping review loop.`);
            break;
          }
        } catch { /* ignore */ }

        // Auto-commit any remaining uncommitted changes from the fix agent
        autoCommitUncommittedChanges(worktreeDir,
          "fix: address code review findings\n\nAuto-committed by pipeline — fix phase did not commit.");

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

      const prAttachments = await getIssueAttachments(issueId);
      const prAttachmentPaths = prAttachments.map(a => a.filePath);
      const prResult = await runClaudePhase({
        workdir: worktreeDir,
        prompt: buildPrCreationPrompt(issue.title, issue.description, repo.defaultBranch, prAttachmentPaths),
        systemPrompt: "Create a pull request using the gh CLI.",
        timeoutMs: PHASE_TIMEOUT_MS,
      });

      phaseSessionIds["7"] = prResult.sessionId!;

      if (!prResult.success) {
        await db.update(issues).set({ phaseSessionIds, status: "failed", error: `PR creation failed: ${prResult.output.substring(0, 2000)}`, updatedAt: new Date() }).where(eq(issues.id, issueId));
        await notify(telegramConfig, `PR creation failed for: <b>${escapeHtml(issue.title)}</b>\n${escapeHtml(prResult.output.substring(0, 200))}`);
        return;
      }

      const prUrlMatch = prResult.output.match(/https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+\/pull\/\d+/);
      const prUrl = prUrlMatch?.[0] || null;

      if (!prUrl) {
        await db.update(issues).set({ phaseSessionIds, status: "failed", error: `PR creation succeeded but no PR URL found in output. Claude may have failed to push or create the PR.\n\nOutput (truncated): ${prResult.output.substring(0, 2000)}`, updatedAt: new Date() }).where(eq(issues.id, issueId));
        await notify(telegramConfig, `PR creation failed for: <b>${escapeHtml(issue.title)}</b>\nNo PR URL found in Claude output.`);
        return;
      }

      // Fetch PR summary from GitHub (the PR body Claude wrote via gh pr create)
      let prSummary = prResult.output;
      try {
        const prJson = execFileSync("gh", ["pr", "view", prUrl, "--json", "title,body"], {
          cwd: repo.localRepoPath,
          encoding: "utf-8",
          timeout: 15000,
        });
        const prData = JSON.parse(prJson);
        if (prData.body) {
          prSummary = prData.body.substring(0, MAX_FALLBACK_CHARS);
        }
      } catch {
        // Fallback: keep raw Claude output as prSummary
      }

      await db.update(issues).set({
        status: "completed",
        prUrl,
        prSummary,
        phaseSessionIds,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(issues.id, issueId));

      await notify(telegramConfig,
        `Issue completed: <b>${escapeHtml(issue.title)}</b>\nPR: ${escapeHtml(prUrl)}`
      );
    }

  } catch (err) {
    await failIssue(issueId, String(err));
    await notify(telegramConfig, `Pipeline failed for: ${escapeHtml(issue.title)}\nError: ${escapeHtml(String(err).substring(0, 200))}`);
  }
}
