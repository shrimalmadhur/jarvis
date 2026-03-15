import { NextResponse } from "next/server";
import { loadAgentDefinitions } from "@/lib/runner/config-loader";
import { db } from "@/lib/db";
import { agentRuns } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { cronToHuman } from "@/lib/utils/cron";

export async function GET() {
  try {
    const definitions = await loadAgentDefinitions(undefined, {
      includeDisabled: true,
      resolveEnv: false,
    });

    const agents = await Promise.all(
      definitions.map(async (def) => {
        const latestRuns = await db
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.agentName, def.config.name))
          .orderBy(desc(agentRuns.createdAt))
          .limit(1);

        const lastRun = latestRuns[0] || null;

        return {
          name: def.config.name,
          enabled: def.config.enabled,
          schedule: def.config.schedule,
          scheduleHuman: cronToHuman(def.config.schedule),
          timezone: def.config.timezone || null,
          envVarCount: Object.keys(def.config.envVars || {}).length,
          soulExcerpt: def.soul.slice(0, 150).replace(/\n/g, " ").trim(),
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
      })
    );

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Error loading cron agents:", error);
    return NextResponse.json(
      { error: "Failed to load agents" },
      { status: 500 }
    );
  }
}
