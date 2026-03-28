import { NextResponse } from "next/server";
import { db, mcpServers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { withErrorHandler, parseBody } from "@/lib/api/utils";
import { mcpServerUpdateSchema } from "@/lib/validations/mcp";

export const runtime = "nodejs";

export const PATCH = withErrorHandler(async (
  request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;
  const raw = await request.json();
  const { data: parsed, error } = parseBody(raw, mcpServerUpdateSchema);
  if (error) return error;

  const [updated] = await db
    .update(mcpServers)
    .set(parsed)
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
