"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";

interface Conversation {
  id: string;
  title: string | null;
  updatedAt: Date;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const router = useRouter();

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (error) {
      console.error("Error fetching conversations:", error);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleNewChat = () => {
    router.push("/chat");
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar conversations={conversations} onNewChat={handleNewChat} />
      <main className="flex flex-1 flex-col overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
