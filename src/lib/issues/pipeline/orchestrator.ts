import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, issueMessages, repositories } from "@/lib/db/schema";
import { getIssueAttachments } from "../attachments";
import { eq } from "drizzle-orm";
import { escapeHtml, sendTelegramMessageWithId } from "@/lib/notifications/telegram";
import type { IssuesTransportConfig } from "../types";
import {
  PHASE_STATUS_MAP, MAX_PLAN_ITERATIONS, MAX_CODE_REVIEW_ITERATIONS,
  PHASE_TIMEOUT_MS, IMPL_TIMEOUT_MS,
} from "../types";
import { isResumeSupported, MAX_FALLBACK_CHARS } from "./claude-runner";
import { runPhase } from "@/lib/harness/run-phase";
import type { HarnessType, HarnessPhaseResult } from "@/lib/harness/types";
import {
  updatePhase, failIssue, isCancelled, sendIssueTransportMessage, notify,
  handleQuestions, getUserAnswers, settledResult,
  ensureWorktreeClean, autoCommitUncommittedChanges, hasBranchCommits,
  createFreshPlanningSession,
} from "./helpers";
import {
  buildFullPlanningPrompt, buildResumePlanningPrompt,
  buildAdversarialReviewPrompt, buildCompletenessReviewPrompt, buildPlanFixPrompt,
  buildImplementationPrompt,
  buildBugsLogicReviewPrompt, buildSecurityEdgeCasesReviewPrompt, buildDesignPerformanceReviewPrompt,
  buildCodeFixPrompt,
  buildPrCreationPrompt,
} from "./prompts";

/** Build the default worktree directory path under `.claude/worktrees/`. */
export function buildWorktreePath(repoPath: string, slug: string, shortId: string): string {
  return join(repoPath, ".claude", "worktrees", `${slug}-${shortId}`);
}

export async function runIssuePipeline(
  issueId: string,
  transportConfig: IssuesTransportConfig
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

  // Determine which coding harness to use for this issue
  const issueHarness: HarnessType = (issue.harness as HarnessType) || "claude";

  // Create or reuse worktree
  const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 40);
  const shortId = issue.id.substring(0, 8);
  const worktreeName = `${slug}-${shortId}`;
  let branchName = issue.branchName || `issue/${worktreeName}`;
  let worktreeDir = issue.worktreePath || buildWorktreePath(repo.localRepoPath, slug, shortId);

  // For Codex: create worktree manually (Codex has no -w flag).
  // For Claude: -w flag on first phase creates it, but we still need the dir for
  // subsequent phases. Pre-create if it doesn't exist on resume/retry.
  if (!existsSync(worktreeDir)) {
    if (issueHarness === "codex") {
      // Codex: full manual worktree creation
      mkdirSync(join(repo.localRepoPath, ".claude", "worktrees"), { recursive: true });

      try {
        execFileSync("git", ["fetch", "origin", repo.defaultBranch], {
          cwd: repo.localRepoPath, stdio: "ignore", timeout: 30_000,
        });
      } catch {
        console.warn(`[pipeline] Could not fetch latest ${repo.defaultBranch} — will use last-known origin/${repo.defaultBranch}`);
      }

      try {
        execFileSync("git", ["worktree", "add", worktreeDir, "-b", branchName, `origin/${repo.defaultBranch}`], {
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
    // Claude: worktree will be created by -w flag on the first phase
  }

  const phaseSessionIds: Record<string, string> = issue.phaseSessionIds as Record<string, string> || {};

  // Determine start phase (resume support)
  const startPhase = issue.currentPhase > 0 ? issue.currentPhase : 1;

  // Check if --resume is supported. Codex always supports resume.
  const resumeSupported = issueHarness === "codex" ? true : await isResumeSupported();

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
      await notify(issueId, transportConfig, `Planning started for: <b>${escapeHtml(issue.title)}</b>`);

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
          let planResult: HarnessPhaseResult;

          if (isFirstPlanRun) {
            // CREATE the planning session
            planResult = await runPhase({
              workdir: issueHarness === "claude" ? repo.localRepoPath : worktreeDir,
              prompt: freshPrompt,
              systemPrompt: "You are an expert implementation planner. Create detailed, actionable plans.",
              timeoutMs: PHASE_TIMEOUT_MS,
              sessionId: planningSessionId,
              harness: issueHarness,
              // Claude: let -w create the worktree; Codex: already created manually
              worktreeName: issueHarness === "claude" && !existsSync(worktreeDir) ? worktreeName : undefined,
            });
            isFirstPlanRun = false;
            // Update planningSessionId to the actual session ID returned by the harness
            // (critical for Codex, which generates its own thread_id instead of using the passed-in UUID)
            if (planResult.sessionId) {
              planningSessionId = planResult.sessionId;
            }
          } else if (resumeSupported) {
            // RESUME the planning session (keeps exploration context!)
            const resumePrompt = buildResumePlanningPrompt(
              currentIssue?.planReview1, currentIssue?.planReview2, userAnswers, attachmentPaths,
            );
            planResult = await runPhase({
              workdir: worktreeDir,
              prompt: resumePrompt,
              timeoutMs: PHASE_TIMEOUT_MS,
              resumeSessionId: planningSessionId,
              harness: issueHarness,
            });

            // If resume failed (not timeout), fall back to fresh session with full context
            if (!planResult.success && !planResult.timedOut) {
              console.log("[pipeline] Planning resume failed, falling back to fresh session");
              const fresh = await createFreshPlanningSession(worktreeDir, freshPrompt, issueId, issueHarness);
              planResult = fresh.result;
              planningSessionId = fresh.sessionId;
            }
          } else {
            // Resume not supported — fresh session each iteration (current behavior)
            const fresh = await createFreshPlanningSession(worktreeDir, freshPrompt, issueId, issueHarness);
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
            const answered = await handleQuestions(issueId, planResult.questions, transportConfig);
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
        await notify(issueId, transportConfig, `Plan verification started (2 reviewers in parallel)`);

        const priorFindingsText = priorPlanFindings.length > 0
          ? priorPlanFindings.join("\n\n========================================\n\n")
              .substring(0, MAX_FALLBACK_CHARS)
          : undefined;

        const planReviewResults = await Promise.allSettled([
          runPhase({ harness: issueHarness,
            workdir: worktreeDir,
            prompt: buildAdversarialReviewPrompt(planOutput, priorFindingsText),
            systemPrompt: "You are an adversarial plan reviewer. Find problems, not validate.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
          runPhase({ harness: issueHarness,
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
          await notify(issueId, transportConfig,
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
          const fixResult = await runPhase({ harness: issueHarness,
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
        await notify(issueId, transportConfig, `Planning failed after ${MAX_PLAN_ITERATIONS} attempts for: ${escapeHtml(issue.title)}`);
        return;
      }

      await notify(issueId, transportConfig, `Plan approved. Starting implementation...`);
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
      const canResume = (
        startPhase <= 4 &&
        currentIssue?.planningSessionId &&
        resumeSupported
      );

      let implResult: HarnessPhaseResult;

      if (canResume) {
        implResult = await runPhase({ harness: issueHarness,
          workdir: worktreeDir,
          prompt: implPrompt,
          timeoutMs: IMPL_TIMEOUT_MS,
          resumeSessionId: currentIssue!.planningSessionId!,
        });

        // If resume failed (not timeout), retry with fresh session
        if (!implResult.success && !implResult.timedOut) {
          console.log("[pipeline] Implementation resume failed, retrying with fresh session");
          implResult = await runPhase({ harness: issueHarness,
            workdir: worktreeDir,
            prompt: implPrompt,
            systemPrompt: "You are an expert software engineer. Implement the plan precisely.",
            timeoutMs: IMPL_TIMEOUT_MS,
          });
        }
      } else {
        // Fresh session (crash recovery, retry, or resume not supported)
        implResult = await runPhase({ harness: issueHarness,
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

      await notify(issueId, transportConfig, `Implementation complete. Starting code review...`);
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
        await notify(issueId, transportConfig,
          `Code review round ${crIterations}/${MAX_CODE_REVIEW_ITERATIONS} (3 specialist reviewers)`
        );

        const codeReviewResults = await Promise.allSettled([
          runPhase({ harness: issueHarness,
            workdir: worktreeDir,
            prompt: buildBugsLogicReviewPrompt(repo.defaultBranch),
            systemPrompt: "You are a bugs & logic reviewer. DO NOT modify files.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
          runPhase({ harness: issueHarness,
            workdir: worktreeDir,
            prompt: buildSecurityEdgeCasesReviewPrompt(repo.defaultBranch),
            systemPrompt: "You are a security reviewer. DO NOT modify files.",
            timeoutMs: PHASE_TIMEOUT_MS,
          }),
          runPhase({ harness: issueHarness,
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
          await notify(issueId, transportConfig, `All code reviews passed!`);
          break;
        }

        if (crIterations >= MAX_CODE_REVIEW_ITERATIONS) break;

        // ── Phase 6: Auto-fix all issues ──
        if (await isCancelled(issueId)) return;
        await updatePhase(issueId, 6, "reviewing_code_2");
        await notify(issueId, transportConfig,
          `Fixing code review findings (round ${crIterations}/${MAX_CODE_REVIEW_ITERATIONS})...`
        );

        // Track HEAD before fix for convergence detection
        let headBefore = "";
        try {
          headBefore = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: worktreeDir, encoding: "utf-8",
          }).trim();
        } catch { /* ignore */ }

        const fixResult = await runPhase({ harness: issueHarness,
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
        try {
          const headAfter = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: worktreeDir, encoding: "utf-8",
          }).trim();
          if (headBefore && headBefore === headAfter) {
            autoCommitUncommittedChanges(worktreeDir,
              "fix: address code review findings\n\nAuto-committed by pipeline — fix phase did not commit.");
            await notify(issueId, transportConfig, `Fix agent made no new commits. Stopping review loop.`);
            break;
          }
        } catch { /* ignore */ }

        // Auto-commit any remaining uncommitted changes from the fix agent
        autoCommitUncommittedChanges(worktreeDir,
          "fix: address code review findings\n\nAuto-committed by pipeline — fix phase did not commit.");

        await notify(issueId, transportConfig, `Fixes applied. Re-reviewing...`);
      }

      if (!codeApproved) {
        await notify(issueId, transportConfig,
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
      const prResult = await runPhase({ harness: issueHarness,
        workdir: worktreeDir,
        prompt: buildPrCreationPrompt(issue.title, issue.description, repo.defaultBranch, prAttachmentPaths),
        systemPrompt: "Create a pull request using the gh CLI.",
        timeoutMs: PHASE_TIMEOUT_MS,
      });

      phaseSessionIds["7"] = prResult.sessionId!;

      if (!prResult.success) {
        await db.update(issues).set({ phaseSessionIds, status: "failed", error: `PR creation failed: ${prResult.output.substring(0, 2000)}`, updatedAt: new Date() }).where(eq(issues.id, issueId));
        await notify(issueId, transportConfig, `PR creation failed for: <b>${escapeHtml(issue.title)}</b>\n${escapeHtml(prResult.output.substring(0, 200))}`);
        return;
      }

      const prUrlMatch = prResult.output.match(/https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+\/pull\/\d+/);
      const prUrl = prUrlMatch?.[0] || null;

      if (!prUrl) {
        await db.update(issues).set({ phaseSessionIds, status: "failed", error: `PR creation succeeded but no PR URL found in output. Claude may have failed to push or create the PR.\n\nOutput (truncated): ${prResult.output.substring(0, 2000)}`, updatedAt: new Date() }).where(eq(issues.id, issueId));
        await notify(issueId, transportConfig, `PR creation failed for: <b>${escapeHtml(issue.title)}</b>\nNo PR URL found in Claude output.`);
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
        prStatus: "open",
        prSummary,
        phaseSessionIds,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(issues.id, issueId));

      // Send completion message and store it in issueMessages so the user
      // can reply to continue the conversation in the same Claude session
      const completionHtml = `Issue completed: <b>${escapeHtml(issue.title)}</b>\nPR: ${escapeHtml(prUrl)}\n\n<i>Reply to this message to continue the conversation.</i>`;
      const completionPlain = `Issue completed: ${issue.title}\nPR: ${prUrl}\n\nReply to this message to continue the conversation.`;
      try {
        if (transportConfig.kind === "telegram") {
          const msgId = await sendTelegramMessageWithId(transportConfig, completionHtml);
          await db.insert(issueMessages).values({
            issueId,
            direction: "from_claude",
            message: completionPlain,
            telegramMessageId: msgId,
          });
        } else {
          const result = await sendIssueTransportMessage(issueId, transportConfig, completionPlain);
          await db.insert(issueMessages).values({
            issueId,
            direction: "from_claude",
            message: completionPlain,
            slackMessageTs: result.slackTs,
          });
        }
      } catch (err) {
        console.error("[pipeline] Failed to send completion notification:", err);
      }
    }

  } catch (err) {
    await failIssue(issueId, String(err));
    await notify(issueId, transportConfig, `Pipeline failed for: ${escapeHtml(issue.title)}\nError: ${escapeHtml(String(err).substring(0, 200))}`);
  }
}
