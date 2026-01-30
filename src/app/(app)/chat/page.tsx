"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChatMessagesList } from "@/components/chat/chat-messages-list";
import { ChatInput } from "@/components/chat/chat-input";

interface Message {
  id?: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  modelUsed?: string | null;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSend = useCallback(
    async (text: string) => {
      const userMessage: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        const data = await res.json();

        if (res.ok) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.message,
              modelUsed: data.model,
            },
          ]);

          if (data.conversationId) {
            router.replace(`/chat/${data.conversationId}`);
          }
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "Sorry, something went wrong. Please try again.",
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Failed to connect. Please check your connection.",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatMessagesList messages={messages} isLoading={isLoading} />
      <div className="border-t border-border bg-background px-4 py-4">
        <div className="mx-auto max-w-2xl">
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}
