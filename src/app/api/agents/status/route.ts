import { NextResponse } from "next/server";
import { scanSessions } from "@/lib/claude/session-reader";

export async function GET() {
  try {
    const status = await scanSessions();
    return NextResponse.json(status);
  } catch (error) {
    console.error("Error scanning agent sessions:", error);
    return NextResponse.json(
      { error: "Failed to scan agent sessions" },
      { status: 500 }
    );
  }
}
