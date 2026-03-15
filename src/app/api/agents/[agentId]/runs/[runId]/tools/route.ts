import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentRunToolUses } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  const { runId } = await params;

  try {
    const tools = await db
      .select()
      .from(agentRunToolUses)
      .where(eq(agentRunToolUses.runId, runId));

    return NextResponse.json({
      tools: tools.map((t) => ({
        id: t.id,
        toolName: t.toolName,
        toolInput: t.toolInput,
        toolOutput: t.toolOutput,
        isError: t.isError,
        durationMs: t.durationMs,
        createdAt: t.createdAt?.toISOString() || null,
      })),
    });
  } catch (error) {
    console.error("Error loading tool uses:", error);
    return NextResponse.json({ error: "Failed to load tool uses" }, { status: 500 });
  }
}
