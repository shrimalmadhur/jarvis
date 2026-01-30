import { NextResponse } from "next/server";
import { db, mcpServers } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
  } catch (error) {
    console.error("Error updating MCP server:", error);
    return NextResponse.json(
      { error: "Failed to update server" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.delete(mcpServers).where(eq(mcpServers.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting MCP server:", error);
    return NextResponse.json(
      { error: "Failed to delete server" },
      { status: 500 }
    );
  }
}
