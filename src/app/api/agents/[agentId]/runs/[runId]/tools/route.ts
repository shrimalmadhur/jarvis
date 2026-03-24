import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentRunToolUses } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api/utils";

export const GET = withErrorHandler(async (_request, { params }) => {
  const { runId } = await params;

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
});
