"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChatMessagesList } from "@/components/chat/chat-messages-list";
import { ChatInput } from "@/components/chat/chat-input";
import { useChatSend } from "@/lib/hooks/use-chat-send";

export default function ChatPage() {
  const router = useRouter();

  const onConversationCreated = useCallback(
    (id: string) => router.replace(`/chat/${id}`),
    [router]
  );

  const { messages, isLoading, handleSend } = useChatSend({
    onConversationCreated,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatMessagesList messages={messages} isLoading={isLoading} />
      <div className="border-t border-border bg-surface/50 backdrop-blur-sm px-6 py-5">
        <div className="mx-auto max-w-4xl 2xl:max-w-5xl">
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}
