import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents, projects, agentRuns } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createAgentSchema } from "@/lib/validations/agent";
import { cronToHuman } from "@/lib/utils/cron";
import { syncCrontab } from "@/lib/cron/sync";
import { withErrorHandler, parseBody } from "@/lib/api/utils";

export const runtime = "nodejs";

export const GET = withErrorHandler(async (_request, { params }) => {
  const { id } = await params;

  // Verify project exists
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (projectRows.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const projectAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.projectId, id));

  // Batch-fetch latest run for all agents in one query
  const agentIds = projectAgents.map((a) => a.id);
  const latestRuns = agentIds.length > 0
    ? await db
        .select()
        .from(agentRuns)
        .where(
          sql`${agentRuns.agentId} IN (${sql.join(agentIds.map((id) => sql`${id}`), sql`, `)}) AND ${agentRuns.createdAt} = (SELECT MAX(created_at) FROM agent_runs ar2 WHERE ar2.agent_id = ${agentRuns.agentId})`
        )
    : [];

  const runsByAgentId = new Map(latestRuns.map((r) => [r.agentId, r]));

  const result = projectAgents.map((agent) => {
    const lastRun = runsByAgentId.get(agent.id) || null;

    return {
      id: agent.id,
      name: agent.name,
      enabled: agent.enabled,
      schedule: agent.schedule,
      scheduleHuman: cronToHuman(agent.schedule),
      timezone: agent.timezone,
      envVarCount: Object.keys((agent.envVars as Record<string, string>) || {}).length,
      soulExcerpt: agent.soul.slice(0, 150).replace(/\n/g, " ").trim(),
      lastRun: lastRun
        ? {
            status: lastRun.status,
            createdAt: lastRun.createdAt?.toISOString() || null,
            durationMs: lastRun.durationMs,
            promptTokens: lastRun.promptTokens,
            completionTokens: lastRun.completionTokens,
            error: lastRun.error,
          }
        : null,
    };
  });

  return NextResponse.json({ agents: result });
});

export const POST = withErrorHandler(async (request, { params }) => {
  const { id } = await params;

  // Verify project exists
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (projectRows.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json();
  const { data: parsed, error } = parseBody(body, createAgentSchema);
  if (error) return error;

  // Check uniqueness within project
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(eq(agents.projectId, id), eq(agents.name, parsed.name))
    )
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "An agent with this name already exists in this project" },
      { status: 409 }
    );
  }

  const [agent] = await db
    .insert(agents)
    .values({
      projectId: id,
      name: parsed.name,
      soul: parsed.soul,
      skill: parsed.skill,
      schedule: parsed.schedule,
      timezone: parsed.timezone || null,
      envVars: parsed.envVars || {},
      enabled: parsed.enabled ?? true,
    })
    .returning();

  syncCrontab();

  return NextResponse.json(agent, { status: 201 });
});
