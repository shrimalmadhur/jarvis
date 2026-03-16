import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runAgentTask } from "@/lib/runner/agent-runner";
import { logRun, getRecentOutputs } from "@/lib/runner/run-log";
import { getAgentTelegramConfig, sendAgentResult } from "@/lib/runner/telegram-sender";
import type { AgentDefinition } from "@/lib/runner/types";
import { startRun, emitRunEvent, endRun } from "@/lib/runner/run-events";

export const maxDuration = 600; // 10 minutes

// Track in-flight runs to prevent concurrent execution of the same agent
const runningAgents = new Set<string>();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  return NextResponse.json({ running: runningAgents.has(agentId) });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  if (runningAgents.has(agentId)) {
    return NextResponse.json(
      { error: "Agent is already running" },
      { status: 409 }
    );
  }

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

    const definition: AgentDefinition = {
      config: {
        name: agent.name,
        enabled: agent.enabled,
        schedule: agent.schedule,
        timezone: agent.timezone || undefined,
        envVars: (agent.envVars as Record<string, string>) || {},
      },
      soul: agent.soul,
      skill: agent.skill,
      agentId: agent.id,
    };

    // Get recent outputs for context (topic dedup)
    const recentOutputs = await getRecentOutputs(agent.name, 30, agent.id);

    runningAgents.add(agentId);
    startRun(agentId);
    emitRunEvent(agentId, {
      type: "started",
      timestamp: Date.now(),
      data: { agentName: agent.name },
    });

    let result;
    try {
      result = await runAgentTask(definition, { recentOutputs }, (event) => {
        emitRunEvent(agentId, event);
      });
    } finally {
      runningAgents.delete(agentId);
    }

    emitRunEvent(agentId, {
      type: "complete",
      timestamp: Date.now(),
      data: {
        success: result.success,
        output: result.output,
        model: result.model,
        promptTokens: result.tokensUsed.prompt,
        completionTokens: result.tokensUsed.completion,
        toolUseCount: result.toolUses.length,
        durationMs: result.durationMs,
        error: result.error || null,
      },
    });
    endRun(agentId);

    // Log the run to DB
    await logRun(result);

    // Send Telegram notification if configured
    if (result.success) {
      try {
        const telegramConfig = await getAgentTelegramConfig(agent.name, agent.id);
        if (telegramConfig) {
          await sendAgentResult(telegramConfig, agent.name, result);
        }
      } catch (err) {
        console.error("Failed to send Telegram notification:", err);
      }
    }

    return NextResponse.json({
      success: result.success,
      output: result.output,
      model: result.model,
      promptTokens: result.tokensUsed.prompt,
      completionTokens: result.tokensUsed.completion,
      toolUseCount: result.toolUses.length,
      durationMs: result.durationMs,
      error: result.error || null,
    });
  } catch (error) {
    runningAgents.delete(agentId);
    emitRunEvent(agentId, {
      type: "complete",
      timestamp: Date.now(),
      data: { success: false, error: "Failed to run agent" },
    });
    endRun(agentId);
    console.error("Error running agent:", error);
    return NextResponse.json(
      { error: "Failed to run agent" },
      { status: 500 }
    );
  }
}
