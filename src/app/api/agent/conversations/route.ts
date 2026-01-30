import { NextResponse } from "next/server";
import {
  listConversations,
  createConversation,
} from "@/lib/agent/conversation-store";

export async function GET() {
  try {
    const convos = await listConversations();
    return NextResponse.json(convos);
  } catch (error) {
    console.error("Error listing conversations:", error);
    return NextResponse.json(
      { error: "Failed to list conversations" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const conv = await createConversation(body.title);
    return NextResponse.json(conv);
  } catch (error) {
    console.error("Error creating conversation:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
