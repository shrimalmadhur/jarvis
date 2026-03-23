import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issues } from "@/lib/db/schema";
import { and, eq, isNull, inArray } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    let repositoryId: string | undefined;
    try {
      const body = await request.json();
      repositoryId = body.repositoryId;
    } catch {
      // No body — archive across all repos
    }

    const conditions = [
      inArray(issues.status, ["completed", "failed"]),
      isNull(issues.archivedAt),
      isNull(issues.lockedBy),
    ];
    if (repositoryId) {
      conditions.push(eq(issues.repositoryId, repositoryId));
    }

    const result = await db
      .update(issues)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: issues.id });

    return NextResponse.json({ archived: result.length });
  } catch (error) {
    console.error("Error in bulk archive:", error);
    return NextResponse.json({ error: "Failed to archive issues" }, { status: 500 });
  }
}
