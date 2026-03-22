import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, issueMessages, repositories } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { sendTelegramMessageWithId, sendTelegramMessage, escapeHtml } from "@/lib/notifications/telegram";
import type { IssuesTelegramConfig, PipelinePhaseResult, IssueStatus } from "./types";
import {
  PHASE_STATUS_MAP, MAX_PLAN_ITERATIONS,
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

/**
 * Run a single Claude CLI phase.
 * Prompt is piped via stdin. Uses --session-id with pre-generated UUID.
 * Parses stream-json output for result text.
 */
async function runClaudePhase(opts: {
  workdir: string;
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  sessionId?: string;
}): Promise<PipelinePhaseResult> {
  const sessionId = opts.sessionId || crypto.randomUUID();
  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--session-id", sessionId,
  ];
  if (opts.systemPrompt) {
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
        sessionId,
        hasQuestions,
        questions,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: err.message, sessionId });
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

function buildCompletenessReviewPrompt(plan: string, review1: string): string {
  return `You are a completeness and feasibility reviewer.

## Plan
${plan}

## Previous Review Feedback
${review1}

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

function buildCodeReview1Prompt(defaultBranch: string): string {
  return `Review the code changes on this branch compared to ${defaultBranch}.

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see all changes
2. Review for:
   - Bugs and logic errors
   - Security vulnerabilities (injection, XSS, etc.)
   - Missing error handling
   - Performance issues
   - Code style consistency
3. **Fix any issues you find** — do not just report them
4. Run the test suite and fix any failures
5. Commit your fixes

End with:
- "VERDICT: PASS" if the code is ready for final review
- "VERDICT: FAIL" if there are unfixable issues`;
}

function buildCodeReview2Prompt(defaultBranch: string): string {
  return `Perform a final verification of the code changes on this branch compared to ${defaultBranch}.

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see all changes
2. Verify:
   - All previous review issues were addressed
   - Tests pass and cover the new code
   - No regressions in existing functionality
   - Code is clean and well-documented
3. Fix any remaining minor issues
4. Run the full test suite one final time

End with:
- "VERDICT: PASS" if everything looks good
- "VERDICT: FAIL" with explanation if not`;
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
  let worktreeDir = issue.worktreePath || join(repo.localRepoPath, ".dobby-worktrees", `${slug}-${shortId}`);

  // Skip worktree creation if it already exists (retry/resume scenario)
  if (!existsSync(worktreeDir)) {
    mkdirSync(join(repo.localRepoPath, ".dobby-worktrees"), { recursive: true });

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

  await db.update(issues).set({
    worktreePath: worktreeDir,
    branchName,
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));

  const phaseSessionIds: Record<string, string> = issue.phaseSessionIds as Record<string, string> || {};

  // Determine start phase (resume support)
  const startPhase = issue.currentPhase > 0 ? issue.currentPhase : 1;

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

      while (!planApproved && planIterations < MAX_PLAN_ITERATIONS) {
        planIterations++;

        let planPrompt = buildPlanningPrompt(issue.description);

        // Include previous review feedback for re-planning
        const [currentIssue] = await db.select().from(issues).where(eq(issues.id, issueId));
        if (planOutput && currentIssue?.planReview1) {
          planPrompt += `\n\n## Previous Plan Review Feedback\n${currentIssue.planReview1}`;
        }

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
          await failIssue(issueId, `Planning failed: ${planResult.output.substring(0, 2000)}`);
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
          const answered = await handleQuestions(issueId, planResult.questions, telegramConfig);
          if (!answered) {
            await failIssue(issueId, "Timed out waiting for user reply to questions");
            return;
          }
          continue;
        }

        // ── Phase 2: Plan Review #1 ──────────────────────────
        if (await isCancelled(issueId)) return;
        await updatePhase(issueId, 2, "reviewing_plan_1");
        await notify(telegramConfig, `Plan review #1 started`);

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

        // Check verdict
        if (/VERDICT:\s*FAIL/i.test(review1Result.output)) {
          if (planIterations >= MAX_PLAN_ITERATIONS) break;
          await notify(telegramConfig, `Plan review found critical issues. Re-planning (attempt ${planIterations + 1}/${MAX_PLAN_ITERATIONS})...`);
          continue;
        }

        // ── Phase 3: Plan Review #2 ──────────────────────────
        if (await isCancelled(issueId)) return;
        await updatePhase(issueId, 3, "reviewing_plan_2");
        await notify(telegramConfig, `Plan review #2 started`);

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

        // Check verdict
        if (/VERDICT:\s*FAIL/i.test(review2Result.output)) {
          if (planIterations >= MAX_PLAN_ITERATIONS) break;
          await notify(telegramConfig, `Completeness review found gaps. Re-planning (attempt ${planIterations + 1}/${MAX_PLAN_ITERATIONS})...`);
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

    // ── Phase 4: Implementation ────────────────────────────
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

      const implResult = await runClaudePhase({
        workdir: worktreeDir,
        prompt: implPrompt,
        systemPrompt: "You are an expert software engineer. Implement the plan precisely.",
        timeoutMs: IMPL_TIMEOUT_MS,
      });

      if (!implResult.success) {
        await failIssue(issueId, `Implementation failed: ${implResult.output.substring(0, 2000)}`);
        return;
      }

      phaseSessionIds["4"] = implResult.sessionId!;
      await db.update(issues).set({ phaseSessionIds, updatedAt: new Date() }).where(eq(issues.id, issueId));
      await notify(telegramConfig, `Implementation complete. Starting code review...`);
    }

    // ── Phase 5: Code Review #1 ────────────────────────────
    if (startPhase <= 5) {
      if (await isCancelled(issueId)) return;
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
      await notify(telegramConfig, `Code review #1 complete`);
    }

    // ── Phase 6: Code Review #2 (verify) ───────────────────
    if (startPhase <= 6) {
      if (await isCancelled(issueId)) return;
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
      await notify(telegramConfig, `Code review #2 complete`);
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
    await notify(telegramConfig, `Pipeline failed for: ${escapeHtml(issue.title)}\nError: ${String(err).substring(0, 200)}`);
  }
}
