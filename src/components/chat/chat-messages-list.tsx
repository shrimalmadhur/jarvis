"use client";

import { useEffect, useRef } from "react";
import { ChatMessage } from "./chat-message";
import { Sparkles } from "lucide-react";

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
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
            <Sparkles className="h-6 w-6 text-accent" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            What can I help you with?
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Ask me anything, or connect MCP servers in Settings to extend my capabilities.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        {visibleMessages.map((msg, i) => (
          <ChatMessage
            key={msg.id || i}
            role={msg.role as "user" | "assistant"}
            content={msg.content}
            model={msg.modelUsed || undefined}
          />
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="rounded-2xl rounded-tl-md bg-assistant-bubble px-4 py-3">
              <div className="flex items-center gap-1">
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
