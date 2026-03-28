import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents, agentRuns } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateAgentSchema } from "@/lib/validations/agent";
import { syncCrontab } from "@/lib/cron/sync";
import { maskToken } from "@/lib/notifications/telegram";
import { withErrorHandler, parseBody } from "@/lib/api/utils";

export const runtime = "nodejs";

export const GET = withErrorHandler(async (_request, { params }) => {
  const { agentId } = await params;

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
    maskedEnvVars[k] = maskToken(v);
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
});

export const PATCH = withErrorHandler(async (request, { params }) => {
  const { agentId } = await params;

  const body = await request.json();
  const { data: parsed, error } = parseBody(body, updateAgentSchema);
  if (error) return error;

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
  if (parsed.name && parsed.name !== current[0].name) {
    const nameConflict = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(eq(agents.projectId, current[0].projectId), eq(agents.name, parsed.name))
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
  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.soul !== undefined) updates.soul = parsed.soul;
  if (parsed.skill !== undefined) updates.skill = parsed.skill;
  if (parsed.schedule !== undefined) updates.schedule = parsed.schedule;
  if (parsed.timezone !== undefined) updates.timezone = parsed.timezone;
  if (parsed.envVars !== undefined) {
    // Preserve original env var values when the submitted value is masked.
    // The GET endpoint masks values (e.g. "post****uire"), so edits that
    // don't touch env vars would otherwise overwrite real credentials.
    const originalEnvVars = (current[0].envVars as Record<string, string>) || {};
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.envVars)) {
      if (k in originalEnvVars) {
        // Check if the submitted value exactly matches the masked form
        // the GET endpoint would produce for the original value.
        const orig = originalEnvVars[k];
        if (v === maskToken(orig)) {
          merged[k] = orig;
          continue;
        }
      }
      merged[k] = v;
    }
    updates.envVars = merged;
  }
  if (parsed.enabled !== undefined) updates.enabled = parsed.enabled;

  const [updated] = await db
    .update(agents)
    .set(updates)
    .where(eq(agents.id, agentId))
    .returning();

  // If name changed, update agentRuns to maintain linkage
  if (parsed.name && parsed.name !== current[0].name) {
    await db
      .update(agentRuns)
      .set({ agentName: parsed.name })
      .where(eq(agentRuns.agentId, agentId));
  }

  // Re-sync crontab if schedule, name, or enabled state changed
  if (
    parsed.schedule !== undefined ||
    parsed.name !== undefined ||
    parsed.enabled !== undefined
  ) {
    syncCrontab();
  }

  return NextResponse.json(updated);
});

export const DELETE = withErrorHandler(async (_request, { params }) => {
  const { agentId } = await params;

  const deleted = await db
    .delete(agents)
    .where(eq(agents.id, agentId))
    .returning();

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  syncCrontab();

  return NextResponse.json({ success: true });
});
