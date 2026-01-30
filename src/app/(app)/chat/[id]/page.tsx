"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { ChatMessagesList } from "@/components/chat/chat-messages-list";
import { ChatInput } from "@/components/chat/chat-input";

interface Message {
  id?: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  modelUsed?: string | null;
}

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/agent/conversations/${params.id}`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
        }
      } catch (error) {
        console.error("Error loading conversation:", error);
      } finally {
        setInitialLoad(false);
      }
    }
    load();
  }, [params.id]);

  const handleSend = useCallback(
    async (text: string) => {
      const userMessage: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: params.id,
            message: text,
          }),
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
    [params.id]
  );

  if (initialLoad) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-1">
          <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        </div>
      </div>
    );
  }

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
