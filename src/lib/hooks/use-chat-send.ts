import { useState, useCallback } from "react";

interface Message {
  id?: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  modelUsed?: string | null;
}

interface UseChatSendOptions {
  conversationId?: string;
  onConversationCreated?: (id: string) => void;
}

export function useChatSend({ conversationId, onConversationCreated }: UseChatSendOptions = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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
            message: text,
            ...(conversationId ? { conversationId } : {}),
          }),
        });

        const data = await res.json();

        if (res.ok) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.message, modelUsed: data.model },
          ]);
          if (data.conversationId && onConversationCreated) {
            onConversationCreated(data.conversationId);
          }
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Sorry, something went wrong. Please try again." },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Failed to connect. Please check your connection." },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, onConversationCreated]
  );

  return { messages, setMessages, isLoading, handleSend };
}
