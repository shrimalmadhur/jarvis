import { NextResponse } from "next/server";
import {
  readSessionDetail,
  readSubAgentDetail,
} from "@/lib/claude/session-detail-reader";
import {
  persistSessionDetail,
  loadSessionDetailFromDB,
} from "@/lib/claude/session-store";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

export const GET = withErrorHandler(async (request, { params }) => {
  const { id: sessionId } = await params;
  const { searchParams } = new URL(request.url);
  const projectDir = searchParams.get("project");
  const subagentId = searchParams.get("subagent");

  if (!projectDir) {
    return NextResponse.json(
      { error: "Missing 'project' query parameter" },
      { status: 400 }
    );
  }

  try {
    // Try reading from disk first
    const detail = subagentId
      ? await readSubAgentDetail(sessionId, projectDir, subagentId)
      : await readSessionDetail(sessionId, projectDir);

    if (detail) {
      // Persist to DB for future retrieval
      try {
        persistSessionDetail(detail, projectDir, subagentId);
      } catch (e) {
        console.error("Failed to persist session detail:", e);
      }
      return NextResponse.json(detail);
    }

    // Disk file gone — fall back to DB
    const fromDB = loadSessionDetailFromDB(sessionId, projectDir, subagentId);
    if (fromDB) {
      return NextResponse.json(fromDB);
    }

    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  } catch (error) {
    // Disk read failed — try DB
    const fromDB = loadSessionDetailFromDB(sessionId, projectDir, subagentId);
    if (fromDB) {
      return NextResponse.json(fromDB);
    }
    throw error;
  }
});
