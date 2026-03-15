import { db } from "@/lib/db";
import { agents, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { AgentDefinition } from "./types";

interface LoadOptions {
  includeDisabled?: boolean;
  projectId?: string;
  projectName?: string;
}

/**
 * Load agent definitions from the database.
 */
export async function loadAgentDefinitionsFromDB(
  options?: LoadOptions
): Promise<AgentDefinition[]> {
  const { includeDisabled = false, projectId, projectName } = options || {};

  let resolvedProjectId = projectId;

  // Resolve project name to ID if needed
  if (!resolvedProjectId && projectName) {
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.name, projectName))
      .limit(1);
    if (rows.length === 0) return [];
    resolvedProjectId = rows[0].id;
  }

  // Build query
  let rows;
  if (resolvedProjectId) {
    rows = await db
      .select()
      .from(agents)
      .where(eq(agents.projectId, resolvedProjectId));
  } else {
    rows = await db.select().from(agents);
  }

  const definitions: AgentDefinition[] = [];

  for (const row of rows) {
    if (!row.enabled && !includeDisabled) continue;

    definitions.push({
      config: {
        name: row.name,
        enabled: row.enabled,
        schedule: row.schedule,
        timezone: row.timezone || undefined,
        envVars: (row.envVars as Record<string, string>) || {},
      },
      soul: row.soul,
      skill: row.skill,
      agentId: row.id,
    });
  }

  return definitions;
}
