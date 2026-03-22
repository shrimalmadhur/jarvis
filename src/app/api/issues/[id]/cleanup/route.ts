import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, repositories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [issue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, id))
      .limit(1);

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    if (!issue.worktreePath) {
      return NextResponse.json({ error: "No worktree to clean up" }, { status: 400 });
    }

    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, issue.repositoryId))
      .limit(1);

    if (repo) {
      try {
        execFileSync("git", ["worktree", "remove", issue.worktreePath, "--force"], {
          cwd: repo.localRepoPath, stdio: "ignore",
        });
        execFileSync("git", ["worktree", "prune"], { cwd: repo.localRepoPath, stdio: "ignore" });
      } catch {
        // Worktree may already be gone
      }
    }

    await db.update(issues).set({
      worktreePath: null,
      updatedAt: new Date(),
    }).where(eq(issues.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error cleaning up worktree:", error);
    return NextResponse.json({ error: "Failed to clean up worktree" }, { status: 500 });
  }
}
