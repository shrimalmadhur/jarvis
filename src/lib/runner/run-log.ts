import { db } from "@/lib/db";
import { agentRuns, agentRunToolUses } from "@/lib/db/schema";
import type { RunResult } from "./types";

/**
 * Log an agent run and its tool uses to the database.
 */
export async function logRun(result: RunResult): Promise<string> {
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
    claudeSessionId: result.claudeSessionId || null,
    claudeSessionProjectDir: result.claudeSessionProjectDir || null,
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

  return run.id;
}
