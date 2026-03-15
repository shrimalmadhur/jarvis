import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { updateProjectSchema } from "@/lib/validations/project";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const project = rows[0];
    const projectAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.projectId, id));

    return NextResponse.json({
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      agents: projectAgents.map((a) => ({
        id: a.id,
        name: a.name,
        enabled: a.enabled,
        schedule: a.schedule,
        timezone: a.timezone,
        envVarCount: Object.keys((a.envVars as Record<string, string>) || {}).length,
      })),
    });
  } catch (error) {
    console.error("Error loading project:", error);
    return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = updateProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    // Check name uniqueness if changing name
    if (parsed.data.name) {
      const existing = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.name, parsed.data.name))
        .limit(1);

      if (existing.length > 0 && existing[0].id !== id) {
        return NextResponse.json(
          { error: "A project with this name already exists" },
          { status: 409 }
        );
      }
    }

    const [updated] = await db
      .update(projects)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating project:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const deleted = await db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
