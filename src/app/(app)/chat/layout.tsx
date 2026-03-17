"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  title: string | null;
  updatedAt: Date;
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const pathname = usePathname();

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/conversations");
      if (res.ok) {
        setConversations(await res.json());
      }
    } catch (error) {
      console.error("Error fetching conversations:", error);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Conversations panel */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Conversations
          </span>
          <Link
            href="/chat"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            title="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {conversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted">
              No conversations yet
            </p>
          ) : (
            <div className="space-y-px">
              {conversations.map((conv) => {
                const isActive = pathname === `/chat/${conv.id}`;
                return (
                  <Link
                    key={conv.id}
                    href={`/chat/${conv.id}`}
                    className={cn(
                      "group flex items-center gap-2 truncate rounded-lg px-3 py-2 text-[14px] transition-all duration-150",
                      isActive
                        ? "bg-surface-raised text-foreground"
                        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    )}
                  >
                    {isActive && (
                      <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                    )}
                    <span className="truncate">
                      {conv.title || "Untitled"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Chat content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
