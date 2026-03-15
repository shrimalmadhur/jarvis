import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentRuns } from "@/lib/db/schema";
import { eq, desc, count } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    const [runs, totalResult] = await Promise.all([
      db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.agentId, agentId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count() })
        .from(agentRuns)
        .where(eq(agentRuns.agentId, agentId)),
    ]);

    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        output: r.output,
        model: r.model,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        toolUseCount: r.toolUseCount,
        durationMs: r.durationMs,
        error: r.error,
        createdAt: r.createdAt?.toISOString() || null,
      })),
      total: totalResult[0]?.count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error loading agent runs:", error);
    return NextResponse.json({ error: "Failed to load runs" }, { status: 500 });
  }
}
