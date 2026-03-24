import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAgentWorkspaceDir } from "@/lib/runner/agent-runner";
import { agentRowToDefinition } from "@/lib/runner/db-config-loader";
import { withErrorHandler } from "@/lib/api/utils";

/**
 * GET /api/agents/:agentId/memories - Read an agent's memory file
 */
export const GET = withErrorHandler(async (_request, { params }) => {
  const { agentId } = await params;

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const definition = agentRowToDefinition(rows[0]);
  const workspaceDir = getAgentWorkspaceDir(definition);
  const memoryPath = join(workspaceDir, "memory.md");

  let content = "";
  const exists = existsSync(memoryPath);
  if (exists) {
    try {
      content = readFileSync(memoryPath, "utf-8");
    } catch {
      content = "";
    }
  }

  return NextResponse.json({
    agentId,
    agentName: rows[0].name,
    content,
    exists,
  });
});

/**
 * DELETE /api/agents/:agentId/memories - Clear an agent's memory file
 */
export const DELETE = withErrorHandler(async (_request, { params }) => {
  const { agentId } = await params;

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const definition = agentRowToDefinition(rows[0]);
  const workspaceDir = getAgentWorkspaceDir(definition);
  const memoryPath = join(workspaceDir, "memory.md");

  if (existsSync(memoryPath)) {
    writeFileSync(memoryPath, "", "utf-8");
  }

  return NextResponse.json({ cleared: true });
});
