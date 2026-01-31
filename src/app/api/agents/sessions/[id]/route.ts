import { NextResponse } from "next/server";
import {
  readSessionDetail,
  readSubAgentDetail,
} from "@/lib/claude/session-detail-reader";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const detail = subagentId
      ? await readSubAgentDetail(sessionId, projectDir, subagentId)
      : await readSessionDetail(sessionId, projectDir);

    if (!detail) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("Error reading session detail:", error);
    return NextResponse.json(
      { error: "Failed to read session detail" },
      { status: 500 }
    );
  }
}
