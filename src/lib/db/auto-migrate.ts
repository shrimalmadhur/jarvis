import { db } from "./index";
import { projects, agents, notificationConfigs } from "./schema";
import { eq, and } from "drizzle-orm";
import { loadAgentDefinitions } from "@/lib/runner/config-loader";

let migrationPromise: Promise<void> | null = null;

/**
 * Auto-migrate filesystem agents to DB on first call.
 * Idempotent — skips agents that already exist in the "Default" project.
 * Promise-cached so concurrent callers share the same execution.
 */
export function autoMigrateFilesystemAgents(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = doMigrate().catch((err) => {
      // Allow retry on next call by clearing the promise
      migrationPromise = null;
      console.warn("[jarvis] Auto-migration of filesystem agents failed:", err);
    });
  }
  return migrationPromise;
}

/**
 * Run the migration. Exported for use by scripts/migrate-fs-agents.ts.
 */
export async function migrateFilesystemAgents(options?: { verbose?: boolean }): Promise<{ migrated: number; skipped: number }> {
  const log = options?.verbose ? console.log.bind(console) : () => {};
  let migrated = 0;
  let skipped = 0;

  const definitions = await loadAgentDefinitions(undefined, {
    includeDisabled: true,
    resolveEnv: false,
  });

  if (definitions.length === 0) {
    log("No filesystem agents found to migrate.");
    return { migrated, skipped };
  }

  // Create or get "Default" project
  let projectId: string;
  const existingProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.name, "Default"))
    .limit(1);

  if (existingProjects.length > 0) {
    projectId = existingProjects[0].id;
    log(`Using existing "Default" project (${projectId})`);
  } else {
    const [created] = await db
      .insert(projects)
      .values({
        name: "Default",
        description: "Auto-migrated from filesystem agents",
      })
      .returning();
    projectId = created.id;
    log(`Created "Default" project (${projectId})`);
  }

  // Resolve ${ENV_VAR} references in env var values (best-effort, skip unresolvable)
  function resolveEnvValue(value: string): string {
    return value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
      const envValue = process.env[varName];
      return envValue ?? _match; // keep original if not resolvable
    });
  }

  // Migrate each agent
  for (const def of definitions) {
    // Skip if already exists in this project (idempotent)
    const existing = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.name, def.config.name), eq(agents.projectId, projectId)))
      .limit(1);

    if (existing.length > 0) {
      log(`  SKIP: "${def.config.name}" already exists in DB`);
      skipped++;
      continue;
    }

    // Resolve env var values
    const resolvedEnvVars: Record<string, string> = {};
    if (def.config.envVars) {
      for (const [k, v] of Object.entries(def.config.envVars)) {
        resolvedEnvVars[k] = resolveEnvValue(v);
      }
    }

    const [created] = await db
      .insert(agents)
      .values({
        projectId,
        name: def.config.name,
        enabled: def.config.enabled,
        soul: def.soul,
        skill: def.skill,
        schedule: def.config.schedule,
        timezone: def.config.timezone || null,
        envVars: resolvedEnvVars,
      })
      .returning();

    log(`  OK: "${def.config.name}" -> agent ID ${created.id}`);

    // Migrate Telegram notification config
    const telegramRows = await db
      .select()
      .from(notificationConfigs)
      .where(eq(notificationConfigs.channel, `telegram-agent:${def.config.name}`))
      .limit(1);

    if (telegramRows.length > 0) {
      await db
        .update(notificationConfigs)
        .set({ channel: `telegram-agent:${created.id}` })
        .where(eq(notificationConfigs.id, telegramRows[0].id));
      log(`       Telegram config migrated to agent ID key`);
    }

    migrated++;
  }

  return { migrated, skipped };
}

async function doMigrate(): Promise<void> {
  const { migrated } = await migrateFilesystemAgents();
  if (migrated > 0) {
    console.log(`[jarvis] Auto-migrated ${migrated} filesystem agent(s) to DB`);
  }
}
