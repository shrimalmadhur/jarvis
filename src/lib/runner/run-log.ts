import { db } from "@/lib/db";
import { agentRuns } from "@/lib/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import type { RunResult } from "./types";

/**
 * Log an agent run to the database.
 */
export async function logRun(result: RunResult): Promise<void> {
  await db.insert(agentRuns).values({
    agentName: result.agentName,
    status: result.success ? "success" : "error",
    output: result.output || null,
    model: result.model,
    promptTokens: result.tokensUsed.prompt,
    completionTokens: result.tokensUsed.completion,
    durationMs: result.durationMs,
    error: result.error || null,
  });
}

/**
 * Get recent successful outputs for an agent (for context injection / topic dedup).
 */
export async function getRecentOutputs(
  agentName: string,
  days: number = 30
): Promise<string[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const runs = await db
    .select({ output: agentRuns.output })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentName, agentName),
        eq(agentRuns.status, "success"),
        gte(agentRuns.createdAt, since)
      )
    )
    .orderBy(desc(agentRuns.createdAt))
    .limit(30);

  return runs.map((r) => r.output).filter((o): o is string => o !== null);
}
