import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issues } from "@/lib/db/schema";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api/utils";

export const POST = withErrorHandler(async (request: Request) => {
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
});
