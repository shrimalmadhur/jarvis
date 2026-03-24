import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issues, repositories } from "@/lib/db/schema";
import { eq, desc, and, isNull, isNotNull, count, type SQL } from "drizzle-orm";
import { ensurePollerRunning } from "@/lib/issues/poller-manager";
import { createIssueSchema } from "@/lib/validations/issue";
import { withErrorHandler } from "@/lib/api/utils";

export const GET = withErrorHandler(async (request: Request) => {
  // Start the in-process Telegram poller on first access (lazy init)
  ensurePollerRunning();

  const { searchParams } = new URL(request.url);
  const repositoryId = searchParams.get("repositoryId");
  const status = searchParams.get("status");
  const archived = searchParams.get("archived");
  const countOnly = searchParams.get("countOnly");

  // Count-only mode: return just the count (used for archived tab badge)
  if (countOnly === "true") {
    const countConditions: SQL[] = [];
    if (repositoryId) countConditions.push(eq(issues.repositoryId, repositoryId));
    if (status) countConditions.push(eq(issues.status, status));
    if (archived === "true") countConditions.push(isNotNull(issues.archivedAt));
    else countConditions.push(isNull(issues.archivedAt));

    const [{ value }] = await db
      .select({ value: count() })
      .from(issues)
      .where(countConditions.length > 0 ? and(...countConditions) : undefined);

    return NextResponse.json({ count: value });
  }

  let query = db
    .select({
      id: issues.id,
      repositoryId: issues.repositoryId,
      repositoryName: repositories.name,
      title: issues.title,
      status: issues.status,
      currentPhase: issues.currentPhase,
      prUrl: issues.prUrl,
      error: issues.error,
      worktreePath: issues.worktreePath,
      createdAt: issues.createdAt,
      updatedAt: issues.updatedAt,
      completedAt: issues.completedAt,
      archivedAt: issues.archivedAt,
    })
    .from(issues)
    .leftJoin(repositories, eq(repositories.id, issues.repositoryId))
    .orderBy(desc(issues.createdAt))
    .$dynamic();

  const conditions: SQL[] = [];
  if (repositoryId) conditions.push(eq(issues.repositoryId, repositoryId));
  if (status) conditions.push(eq(issues.status, status));
  // By default exclude archived issues; only include them when explicitly requested
  if (archived === "true") conditions.push(isNotNull(issues.archivedAt));
  else conditions.push(isNull(issues.archivedAt));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const rows = await query.limit(200);

  const result = rows.map((row) => ({
    id: row.id,
    repositoryId: row.repositoryId,
    repositoryName: row.repositoryName,
    title: row.title,
    status: row.status,
    currentPhase: row.currentPhase,
    prUrl: row.prUrl,
    error: row.error,
    hasWorktree: row.worktreePath != null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() || null,
    archivedAt: row.archivedAt?.toISOString() || null,
  }));

  return NextResponse.json({ issues: result });
});

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const parsed = createIssueSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  // Verify repository exists
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, parsed.data.repositoryId))
    .limit(1);

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const [issue] = await db.insert(issues).values({
    repositoryId: parsed.data.repositoryId,
    title: parsed.data.title,
    description: parsed.data.description,
  }).returning();

  return NextResponse.json(issue, { status: 201 });
});
