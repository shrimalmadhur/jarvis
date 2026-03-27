"use client";

import { useEffect, useRef } from "react";
import { ChatMessage } from "./chat-message";
import { Bot } from "lucide-react";

interface Message {
  id?: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  modelUsed?: string | null;
}

interface ChatMessagesListProps {
  messages: Message[];
  isLoading?: boolean;
}

export function ChatMessagesList({
  messages,
  isLoading,
}: ChatMessagesListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const visibleMessages = messages.filter(
    (m) => m.role !== "tool" && m.content
  );

  if (visibleMessages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-fade-in text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 border border-accent/10">
            <Bot className="h-7 w-7 text-accent" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            Dobby is ready!
          </h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Send a message to get started. Visit Settings to configure integrations and tools.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto max-w-4xl 2xl:max-w-5xl space-y-6">
        {visibleMessages.map((msg, i) => (
          <ChatMessage
            key={msg.id || i}
            role={msg.role as "user" | "assistant"}
            content={msg.content}
            model={msg.modelUsed || undefined}
          />
        ))}
        {isLoading && (
          <div className="flex gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-raised border border-border text-muted-foreground">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl rounded-tl-lg bg-assistant-bubble border border-border/50 px-5 py-4">
              <div className="flex items-center gap-1.5">
                <span className="loading-dot h-2 w-2 rounded-full bg-muted-foreground" />
                <span className="loading-dot h-2 w-2 rounded-full bg-muted-foreground" />
                <span className="loading-dot h-2 w-2 rounded-full bg-muted-foreground" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
