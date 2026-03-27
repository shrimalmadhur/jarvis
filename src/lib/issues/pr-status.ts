import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { issues, repositories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const execFileAsync = promisify(execFile);

export type PrStatus = "open" | "closed" | "merged";

/**
 * Fetch the current PR status from GitHub using the `gh` CLI.
 * Returns normalized lowercase status or null on any failure.
 */
export async function fetchPrStatus(prUrl: string, cwd?: string): Promise<PrStatus | null> {
  try {
    const { stdout } = await execFileAsync("gh", ["pr", "view", prUrl, "--json", "state"], {
      timeout: 10000,
      encoding: "utf-8",
      cwd,
    });
    const data = JSON.parse(stdout);
    const state = (data.state as string)?.toLowerCase();
    if (state === "open" || state === "closed" || state === "merged") {
      return state;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Refresh the PR status for an issue. Skips refresh for terminal states (closed/merged).
 * Returns the resolved prStatus value (fetched, existing terminal, or null on failure).
 */
export async function refreshPrStatus(issueId: string): Promise<PrStatus | null> {
  try {
    const [issue] = await db
      .select({
        prUrl: issues.prUrl,
        prStatus: issues.prStatus,
        repositoryId: issues.repositoryId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    if (!issue || !issue.prUrl) return null;

    // Terminal states don't need refresh
    if (issue.prStatus === "closed" || issue.prStatus === "merged") {
      return issue.prStatus as PrStatus;
    }

    // Get repo localRepoPath for cwd (matches pipeline pattern)
    const [repo] = await db
      .select({ localRepoPath: repositories.localRepoPath })
      .from(repositories)
      .where(eq(repositories.id, issue.repositoryId))
      .limit(1);

    const status = await fetchPrStatus(issue.prUrl, repo?.localRepoPath);
    if (!status) return (issue.prStatus as PrStatus) ?? null;

    // Update DB if status changed
    if (status !== issue.prStatus) {
      await db.update(issues).set({
        prStatus: status,
        updatedAt: new Date(),
      }).where(eq(issues.id, issueId));
    }

    return status;
  } catch {
    return null;
  }
}
