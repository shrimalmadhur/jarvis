import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { repositories, issues } from "@/lib/db/schema";
import { eq, count, and, isNotNull, isNull } from "drizzle-orm";
import { updateRepositorySchema } from "@/lib/validations/repository";
import { withErrorHandler, parseBody } from "@/lib/api/utils";
import { forceRemoveWorktree, pruneWorktrees } from "@/lib/issues/git-worktree";

export const runtime = "nodejs";

export const GET = withErrorHandler(async (
  _request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;

  const rows = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      githubRepoUrl: repositories.githubRepoUrl,
      localRepoPath: repositories.localRepoPath,
      defaultBranch: repositories.defaultBranch,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
      issueCount: count(issues.id),
    })
    .from(repositories)
    .leftJoin(issues, and(eq(issues.repositoryId, repositories.id), isNull(issues.archivedAt)))
    .where(eq(repositories.id, id))
    .groupBy(repositories.id)
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const row = rows[0];
  return NextResponse.json({
    id: row.id,
    name: row.name,
    githubRepoUrl: row.githubRepoUrl,
    localRepoPath: row.localRepoPath,
    defaultBranch: row.defaultBranch,
    issueCount: row.issueCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

export const PATCH = withErrorHandler(async (
  request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;

  const body = await request.json();
  const { data: parsed, error } = parseBody(body, updateRepositorySchema);
  if (error) return error;

  if (parsed.name) {
    const existing = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.name, parsed.name))
      .limit(1);

    if (existing.length > 0 && existing[0].id !== id) {
      return NextResponse.json(
        { error: "A repository with this name already exists" },
        { status: 409 }
      );
    }
  }

  // Validate localRepoPath if being changed
  if (parsed.localRepoPath) {
    if (!existsSync(parsed.localRepoPath)) {
      return NextResponse.json({ error: "Local repo path does not exist" }, { status: 400 });
    }
    try {
      execFileSync("git", ["rev-parse", "--git-dir"], { cwd: parsed.localRepoPath, stdio: "ignore" });
    } catch {
      return NextResponse.json({ error: "Path is not a git repository" }, { status: 400 });
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.name !== undefined) updateData.name = parsed.name;
  if (parsed.githubRepoUrl !== undefined) updateData.githubRepoUrl = parsed.githubRepoUrl || null;
  if (parsed.localRepoPath !== undefined) updateData.localRepoPath = parsed.localRepoPath;
  if (parsed.defaultBranch !== undefined) updateData.defaultBranch = parsed.defaultBranch;

  const [updated] = await db
    .update(repositories)
    .set(updateData)
    .where(eq(repositories.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
});

export const DELETE = withErrorHandler(async (
  _request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;

  // Reject deletion if there are active (locked) pipelines
  const [{ activeCount }] = await db
    .select({ activeCount: count() })
    .from(issues)
    .where(and(eq(issues.repositoryId, id), isNotNull(issues.lockedBy)));

  if (activeCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${activeCount} active pipeline(s) running. Cancel them first.` },
      { status: 409 }
    );
  }

  // Clean up worktrees for all issues before cascade delete
  const repoIssues = await db.select({ worktreePath: issues.worktreePath })
    .from(issues)
    .where(eq(issues.repositoryId, id));

  const [repo] = await db.select({ localRepoPath: repositories.localRepoPath })
    .from(repositories).where(eq(repositories.id, id)).limit(1);

  if (repo) {
    for (const issue of repoIssues) {
      if (issue.worktreePath) forceRemoveWorktree(issue.worktreePath, repo.localRepoPath);
    }
    pruneWorktrees(repo.localRepoPath);
  }

  const deleted = await db
    .delete(repositories)
    .where(eq(repositories.id, id))
    .returning();

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});
