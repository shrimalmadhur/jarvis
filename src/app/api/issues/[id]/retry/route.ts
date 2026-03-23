import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issues } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PHASE_STATUS_MAP } from "@/lib/issues/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [issue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, id))
      .limit(1);

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    if (issue.status !== "failed") {
      return NextResponse.json(
        { error: "Only failed issues can be retried" },
        { status: 400 }
      );
    }

    // Reset to the phase that failed
    const resumeStatus = PHASE_STATUS_MAP[issue.currentPhase] || "pending";

    // Clear stale outputs for the failed phase and all subsequent phases
    const clearFields: Record<string, null> = {};
    const phase = issue.currentPhase;
    if (phase <= 1) clearFields.planOutput = null;
    // Phase 2 produces both plan reviews in parallel
    if (phase <= 2) { clearFields.planReview1 = null; clearFields.planReview2 = null; }
    if (phase === 3) { clearFields.planReview1 = null; clearFields.planReview2 = null; } // backward compat
    if (phase <= 5) clearFields.codeReview1 = null;
    if (phase <= 6) clearFields.codeReview2 = null;

    const [updated] = await db
      .update(issues)
      .set({
        ...clearFields,
        status: resumeStatus,
        error: null,
        planningSessionId: null, // Force fresh session on retry
        lockedBy: null,
        lockedAt: null,
        archivedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error retrying issue:", error);
    return NextResponse.json({ error: "Failed to retry issue" }, { status: 500 });
  }
}
