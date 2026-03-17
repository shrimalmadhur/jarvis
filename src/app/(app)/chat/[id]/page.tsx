"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChatMessagesList } from "@/components/chat/chat-messages-list";
import { ChatInput } from "@/components/chat/chat-input";
import { AlertTriangle } from "lucide-react";

interface Message {
  id?: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  modelUsed?: string | null;
}

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!params.id) return;
      setError(null);
      try {
        const res = await fetch(`/api/agent/conversations/${params.id}`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
        } else if (res.status === 404) {
          setError("Conversation not found.");
        } else {
          setError("Failed to load conversation.");
        }
      } catch {
        setError("Couldn't connect to the server.");
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

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-fade-in text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red/10">
            <AlertTriangle className="h-6 w-6 text-red" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {error}
          </h2>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => {
                setError(null);
                setInitialLoad(true);
                fetch(`/api/agent/conversations/${params.id}`)
                  .then((res) => {
                    if (res.ok) return res.json();
                    throw new Error("Failed");
                  })
                  .then((data) => setMessages(data.messages || []))
                  .catch(() => setError("Still unable to load conversation."))
                  .finally(() => setInitialLoad(false));
              }}
              className="rounded-lg bg-surface-raised px-4 py-2 text-sm text-foreground transition-colors hover:bg-surface-hover"
            >
              Retry
            </button>
            <button
              onClick={() => router.push("/chat")}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              New chat
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatMessagesList messages={messages} isLoading={isLoading} />
      <div className="border-t border-border bg-surface/50 backdrop-blur-sm px-6 py-5">
        <div className="mx-auto max-w-4xl">
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}
