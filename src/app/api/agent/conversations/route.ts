import { NextResponse } from "next/server";
import {
  listConversations,
  createConversation,
} from "@/lib/agent/conversation-store";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

export const GET = withErrorHandler(async () => {
  const convos = await listConversations();
  return NextResponse.json(convos);
});

export const POST = withErrorHandler(async (request) => {
  const body = await request.json();
  const conv = await createConversation(body.title);
  return NextResponse.json(conv);
});
