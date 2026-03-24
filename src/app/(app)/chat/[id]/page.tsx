"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChatMessagesList } from "@/components/chat/chat-messages-list";
import { ChatInput } from "@/components/chat/chat-input";
import { AlertTriangle } from "lucide-react";
import { useChatSend } from "@/lib/hooks/use-chat-send";

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { messages, setMessages, isLoading, handleSend } = useChatSend({
    conversationId: params.id,
  });

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
  }, [params.id, setMessages]);

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
        <div className="mx-auto max-w-4xl 2xl:max-w-5xl">
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}
