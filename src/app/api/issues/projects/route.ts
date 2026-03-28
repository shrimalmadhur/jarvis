import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { repositories, issues } from "@/lib/db/schema";
import { eq, count, desc } from "drizzle-orm";
import { createRepositorySchema } from "@/lib/validations/repository";
import { withErrorHandler, parseBody } from "@/lib/api/utils";

export const runtime = "nodejs";

export const GET = withErrorHandler(async () => {
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
    .leftJoin(issues, eq(issues.repositoryId, repositories.id))
    .groupBy(repositories.id)
    .orderBy(desc(repositories.createdAt));

  const result = rows.map((row) => ({
    id: row.id,
    name: row.name,
    githubRepoUrl: row.githubRepoUrl,
    localRepoPath: row.localRepoPath,
    defaultBranch: row.defaultBranch,
    issueCount: row.issueCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return NextResponse.json({ repositories: result });
});

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const { data: parsed, error } = parseBody(body, createRepositorySchema);
  if (error) return error;

  // Check uniqueness
  const existing = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.name, parsed.name))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "A repository with this name already exists" },
      { status: 409 }
    );
  }

  // Verify local path exists
  if (!existsSync(parsed.localRepoPath)) {
    return NextResponse.json(
      { error: "Local repo path does not exist" },
      { status: 400 }
    );
  }

  // Verify it's a git repo
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: parsed.localRepoPath, stdio: "ignore" });
  } catch {
    return NextResponse.json(
      { error: "Path is not a git repository" },
      { status: 400 }
    );
  }

  const [repo] = await db
    .insert(repositories)
    .values({
      name: parsed.name,
      githubRepoUrl: parsed.githubRepoUrl || null,
      localRepoPath: parsed.localRepoPath,
      defaultBranch: parsed.defaultBranch,
    })
    .returning();

  return NextResponse.json(repo, { status: 201 });
});
