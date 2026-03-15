import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents, agentRuns } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateAgentSchema } from "@/lib/validations/agent";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  try {
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const agent = rows[0];
    // Mask env var values — only expose keys + masked values
    const rawEnvVars = (agent.envVars as Record<string, string>) || {};
    const maskedEnvVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawEnvVars)) {
      maskedEnvVars[k] = v.length <= 8 ? "****" : v.substring(0, 4) + "****" + v.substring(v.length - 4);
    }

    return NextResponse.json({
      id: agent.id,
      projectId: agent.projectId,
      name: agent.name,
      enabled: agent.enabled,
      soul: agent.soul,
      skill: agent.skill,
      schedule: agent.schedule,
      timezone: agent.timezone,
      envVars: maskedEnvVars,
      envVarKeys: Object.keys(rawEnvVars),
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error loading agent:", error);
    return NextResponse.json({ error: "Failed to load agent" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  try {
    const body = await request.json();
    const parsed = updateAgentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    // Get current agent to check for name change
    const current = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (current.length === 0) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Check name uniqueness within project if renaming
    if (parsed.data.name && parsed.data.name !== current[0].name) {
      const nameConflict = await db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(eq(agents.projectId, current[0].projectId), eq(agents.name, parsed.data.name))
        )
        .limit(1);
      if (nameConflict.length > 0 && nameConflict[0].id !== agentId) {
        return NextResponse.json(
          { error: "An agent with this name already exists in this project" },
          { status: 409 }
        );
      }
    }

    // Map validated fields to DB columns
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.soul !== undefined) updates.soul = parsed.data.soul;
    if (parsed.data.skill !== undefined) updates.skill = parsed.data.skill;
    if (parsed.data.schedule !== undefined) updates.schedule = parsed.data.schedule;
    if (parsed.data.timezone !== undefined) updates.timezone = parsed.data.timezone;
    if (parsed.data.envVars !== undefined) updates.envVars = parsed.data.envVars;
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;

    const [updated] = await db
      .update(agents)
      .set(updates)
      .where(eq(agents.id, agentId))
      .returning();

    // If name changed, update agentRuns to maintain linkage
    if (parsed.data.name && parsed.data.name !== current[0].name) {
      await db
        .update(agentRuns)
        .set({ agentName: parsed.data.name })
        .where(eq(agentRuns.agentId, agentId));
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating agent:", error);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  try {
    const deleted = await db
      .delete(agents)
      .where(eq(agents.id, agentId))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting agent:", error);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
