import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issueMessages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api/utils";

export const GET = withErrorHandler(async (
  _request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;

  const messages = await db
    .select()
    .from(issueMessages)
    .where(eq(issueMessages.issueId, id))
    .orderBy(issueMessages.createdAt);

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});
