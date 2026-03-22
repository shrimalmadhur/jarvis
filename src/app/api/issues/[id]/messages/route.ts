import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issueMessages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
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
  } catch (error) {
    console.error("Error loading messages:", error);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}
