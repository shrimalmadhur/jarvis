import { NextResponse } from "next/server";
import { getConversation } from "@/lib/agent/conversation-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const conv = await getConversation(id);

    if (!conv) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(conv);
  } catch (error) {
    console.error("Error getting conversation:", error);
    return NextResponse.json(
      { error: "Failed to get conversation" },
      { status: 500 }
    );
  }
}
