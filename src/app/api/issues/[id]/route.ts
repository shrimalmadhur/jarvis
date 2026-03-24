import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { issues, issueMessages, repositories } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

export const GET = withErrorHandler(async (
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

  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, issue.repositoryId))
    .limit(1);

  const messages = await db
    .select()
    .from(issueMessages)
    .where(eq(issueMessages.issueId, id))
    .orderBy(issueMessages.createdAt);

  return NextResponse.json({
    id: issue.id,
    repositoryId: issue.repositoryId,
    repositoryName: repo?.name || "Unknown",
    localRepoPath: repo?.localRepoPath,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    currentPhase: issue.currentPhase,
    prUrl: issue.prUrl,
    prSummary: issue.prSummary,
    phaseSessionIds: issue.phaseSessionIds,
    planOutput: issue.planOutput,
    planReview1: issue.planReview1,
    planReview2: issue.planReview2,
    codeReview1: issue.codeReview1,
    codeReview2: issue.codeReview2,
    worktreePath: issue.worktreePath,
    branchName: issue.branchName,
    error: issue.error,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    completedAt: issue.completedAt?.toISOString() || null,
    archivedAt: issue.archivedAt?.toISOString() || null,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

export const PATCH = withErrorHandler(async (
  request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;

  const body = await request.json();
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.status) {
    // Only allow setting to "failed" (cancellation) via PATCH.
    // Other status transitions are managed by the pipeline itself.
    if (body.status !== "failed") {
      return NextResponse.json({ error: "Only 'failed' status can be set via PATCH (cancellation)" }, { status: 400 });
    }
    updateData.status = body.status;
  }
  if (body.error !== undefined) {
    updateData.error = typeof body.error === "string" ? body.error.substring(0, 10000) : null;
  }

  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") {
      return NextResponse.json(
        { error: "archived must be a boolean" },
        { status: 400 }
      );
    }
    if (body.archived === true) {
      // Only allow archiving terminal issues
      const [current] = await db
        .select({ status: issues.status })
        .from(issues)
        .where(eq(issues.id, id))
        .limit(1);
      if (!current) {
        return NextResponse.json({ error: "Issue not found" }, { status: 404 });
      }
      if (current.status !== "completed" && current.status !== "failed") {
        return NextResponse.json(
          { error: "Only completed or failed issues can be archived" },
          { status: 400 }
        );
      }
      updateData.archivedAt = new Date();
    } else {
      updateData.archivedAt = null;
    }
  }

  // Use atomic WHERE with status guard to prevent TOCTOU race on archive
  const whereConditions = [eq(issues.id, id)];
  if (body.archived === true) {
    whereConditions.push(inArray(issues.status, ["completed", "failed"]));
  }

  const [updated] = await db
    .update(issues)
    .set(updateData)
    .where(whereConditions.length > 1 ? and(...whereConditions) : whereConditions[0])
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
});

export const DELETE = withErrorHandler(async (
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

  // Clean up worktree if it exists
  if (issue.worktreePath) {
    try {
      const [repo] = await db.select().from(repositories)
        .where(eq(repositories.id, issue.repositoryId)).limit(1);
      if (repo) {
        execFileSync("git", ["worktree", "remove", issue.worktreePath, "--force"], {
          cwd: repo.localRepoPath, stdio: "ignore",
        });
        execFileSync("git", ["worktree", "prune"], { cwd: repo.localRepoPath, stdio: "ignore" });
      }
    } catch {
      // Best effort cleanup
    }
  }

  await db.delete(issues).where(eq(issues.id, id));

  return NextResponse.json({ success: true });
});
