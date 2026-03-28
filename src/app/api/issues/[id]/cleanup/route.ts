import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issues, repositories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api/utils";
import { removeWorktree } from "@/lib/issues/git-worktree";

export const runtime = "nodejs";

export const POST = withErrorHandler(async (
  _request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;

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

  if (repo) removeWorktree(issue.worktreePath, repo.localRepoPath);

  await db.update(issues).set({
    worktreePath: null,
    updatedAt: new Date(),
  }).where(eq(issues.id, id));

  return NextResponse.json({ success: true });
});
