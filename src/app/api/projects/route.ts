import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, agents } from "@/lib/db/schema";
import { eq, count, desc, sql } from "drizzle-orm";
import { createProjectSchema } from "@/lib/validations/project";
import { autoMigrateFilesystemAgents } from "@/lib/db/auto-migrate";

export async function GET() {
  try {
    await autoMigrateFilesystemAgents();
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        agentCount: sql<number>`(SELECT COUNT(*) FROM agents WHERE agents.project_id = ${projects.id})`,
      })
      .from(projects)
      .orderBy(desc(projects.createdAt));

    const result = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      agentCount: row.agentCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return NextResponse.json({ projects: result });
  } catch (error) {
    console.error("Error loading projects:", error);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    // Check uniqueness
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.name, parsed.data.name))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "A project with this name already exists" },
        { status: 409 }
      );
    }

    const [project] = await db
      .insert(projects)
      .values({
        name: parsed.data.name,
        description: parsed.data.description || null,
      })
      .returning();

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
