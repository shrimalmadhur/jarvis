import { NextResponse } from "next/server";
import { db, mcpServers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api/utils";

export const PATCH = withErrorHandler(async (
  request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;
  const body = await request.json();

  const [updated] = await db
    .update(mcpServers)
    .set(body)
    .where(eq(mcpServers.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Server not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(updated);
});

export const DELETE = withErrorHandler(async (
  _request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;

  await db.delete(mcpServers).where(eq(mcpServers.id, id));

  return NextResponse.json({ success: true });
});
