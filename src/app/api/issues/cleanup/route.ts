import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, repositories } from "@/lib/db/schema";
import { eq, and, isNotNull, isNull, inArray } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

export const POST = withErrorHandler(async (request: Request) => {
  // Optional: scope cleanup to a specific repository
  let repositoryId: string | undefined;
  try {
    const body = await request.json();
    repositoryId = body.repositoryId;
  } catch {
    // No body or invalid JSON — clean all repos
  }

  // Find all eligible issues: completed/failed, has worktree, not locked
  const conditions = [
    isNotNull(issues.worktreePath),
    isNull(issues.lockedBy),
    inArray(issues.status, ["completed", "failed"]),
  ];
  if (repositoryId) {
    conditions.push(eq(issues.repositoryId, repositoryId));
  }

  const eligibleIssues = await db
    .select({
      id: issues.id,
      worktreePath: issues.worktreePath,
      repositoryId: issues.repositoryId,
      localRepoPath: repositories.localRepoPath,
    })
    .from(issues)
    .innerJoin(repositories, eq(repositories.id, issues.repositoryId))
    .where(and(...conditions));

  if (eligibleIssues.length === 0) {
    return NextResponse.json({ cleaned: 0, errors: [] });
  }

  // Group by repository so we prune once per repo
  const byRepo = new Map<string, typeof eligibleIssues>();
  for (const issue of eligibleIssues) {
    const group = byRepo.get(issue.repositoryId) || [];
    group.push(issue);
    byRepo.set(issue.repositoryId, group);
  }

  let cleaned = 0;
  const errors: { issueId: string; error: string }[] = [];

  for (const [, repoIssues] of byRepo) {
    const repoPath = repoIssues[0].localRepoPath;

    for (const issue of repoIssues) {
      try {
        execFileSync("git", ["worktree", "remove", issue.worktreePath!, "--force"], {
          cwd: repoPath, stdio: "ignore",
        });
      } catch {
        // Worktree may already be gone from disk — still clear DB
      }

      try {
        await db.update(issues).set({
          worktreePath: null,
          updatedAt: new Date(),
        }).where(eq(issues.id, issue.id));
        cleaned++;
      } catch (e) {
        errors.push({ issueId: issue.id, error: String(e) });
      }
    }

    // Prune once per repo
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: repoPath, stdio: "ignore" });
    } catch {
      // Best-effort prune
    }
  }

  return NextResponse.json({ cleaned, errors });
});
