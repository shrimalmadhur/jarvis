import { NextResponse } from "next/server";
import { getConversation } from "@/lib/agent/conversation-store";
import { withErrorHandler } from "@/lib/api/utils";

export const GET = withErrorHandler(async (_request, { params }) => {
  const { id } = await params;
  const conv = await getConversation(id);

  if (!conv) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(conv);
});
