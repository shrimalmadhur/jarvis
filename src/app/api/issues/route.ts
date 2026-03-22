import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issues, repositories } from "@/lib/db/schema";
import { eq, desc, and, type SQL } from "drizzle-orm";
import { ensurePollerRunning } from "@/lib/issues/poller-manager";
import { createIssueSchema } from "@/lib/validations/issue";

export async function GET(request: Request) {
  // Start the in-process Telegram poller on first access (lazy init)
  ensurePollerRunning();
  try {
    const { searchParams } = new URL(request.url);
    const repositoryId = searchParams.get("repositoryId");
    const status = searchParams.get("status");

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
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
        completedAt: issues.completedAt,
      })
      .from(issues)
      .leftJoin(repositories, eq(repositories.id, issues.repositoryId))
      .orderBy(desc(issues.createdAt))
      .$dynamic();

    const conditions: SQL[] = [];
    if (repositoryId) conditions.push(eq(issues.repositoryId, repositoryId));
    if (status) conditions.push(eq(issues.status, status));
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
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() || null,
    }));

    return NextResponse.json({ issues: result });
  } catch (error) {
    console.error("Error loading issues:", error);
    return NextResponse.json({ error: "Failed to load issues" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    console.error("Error creating issue:", error);
    return NextResponse.json({ error: "Failed to create issue" }, { status: 500 });
  }
}
