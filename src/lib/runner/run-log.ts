import { db } from "@/lib/db";
import { agentRuns, agentRunToolUses } from "@/lib/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import type { RunResult } from "./types";

/**
 * Log an agent run and its tool uses to the database.
 */
export async function logRun(result: RunResult): Promise<void> {
  const [run] = await db.insert(agentRuns).values({
    agentName: result.agentName,
    agentId: result.agentId || null,
    status: result.success ? "success" : "error",
    output: result.output || null,
    model: result.model,
    promptTokens: result.tokensUsed.prompt,
    completionTokens: result.tokensUsed.completion,
    toolUseCount: result.toolUses.length,
    durationMs: result.durationMs,
    error: result.error || null,
  }).returning();

  // Log individual tool uses
  if (result.toolUses.length > 0 && run) {
    await db.insert(agentRunToolUses).values(
      result.toolUses.map((tu) => ({
        runId: run.id,
        toolName: tu.toolName,
        toolInput: tu.toolInput || null,
        toolOutput: tu.toolOutput || null,
        isError: tu.isError,
        durationMs: tu.durationMs || null,
      }))
    );
  }
}

/**
 * Get recent successful outputs for an agent (for context injection / topic dedup).
 * Prefers agentId lookup for DB agents, falls back to agentName for filesystem agents.
 */
export async function getRecentOutputs(
  agentName: string,
  days: number = 30,
  agentId?: string
): Promise<string[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const nameFilter = agentId
    ? eq(agentRuns.agentId, agentId)
    : eq(agentRuns.agentName, agentName);

  const runs = await db
    .select({ output: agentRuns.output })
    .from(agentRuns)
    .where(
      and(
        nameFilter,
        eq(agentRuns.status, "success"),
        gte(agentRuns.createdAt, since)
      )
    )
    .orderBy(desc(agentRuns.createdAt))
    .limit(30);

  return runs.map((r) => r.output).filter((o): o is string => o !== null);
}
