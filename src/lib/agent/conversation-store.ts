import { db, conversations, messages } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import type { LLMMessage } from "@/lib/ai/types";
import type { ToolCallData } from "@/lib/db/schema";

/**
 * Create a new conversation.
 */
export async function createConversation(
  title?: string
): Promise<{ id: string; title: string | null }> {
  const [conv] = await db
    .insert(conversations)
    .values({ title: title || null })
    .returning();

  return { id: conv.id, title: conv.title };
}

/**
 * Get a conversation by ID, with its messages.
 */
export async function getConversation(conversationId: string) {
  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conv) return null;

  const msgs = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [messages.createdAt],
  });

  return {
    ...conv,
    messages: msgs.map(dbMessageToLLM),
  };
}

/**
 * List all conversations (most recent first).
 */
export async function listConversations() {
  return db.query.conversations.findMany({
    orderBy: [desc(conversations.updatedAt)],
  });
}

/**
 * Add a message to a conversation.
 */
export async function addMessage(
  conversationId: string,
  message: LLMMessage,
  modelUsed?: string
): Promise<void> {
  await db.insert(messages).values({
    conversationId,
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls
      ? (message.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })) as ToolCallData[])
      : null,
    toolCallId: message.toolCallId || null,
    providerData: message._providerParts || null,
    modelUsed: modelUsed || null,
  });

  // Update conversation timestamp
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/**
 * Update conversation title.
 */
export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<void> {
  await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/**
 * Convert a DB message row to an LLMMessage.
 */
function dbMessageToLLM(
  msg: typeof messages.$inferSelect
): LLMMessage {
  const result: LLMMessage = {
    role: msg.role as LLMMessage["role"],
    content: msg.content,
  };

  if (msg.toolCalls) {
    const calls = msg.toolCalls as ToolCallData[];
    result.toolCalls = calls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    }));
  }

  if (msg.toolCallId) {
    result.toolCallId = msg.toolCallId;
  }

  if (msg.providerData) {
    result._providerParts = msg.providerData as unknown[];
  }

  return result;
}
