"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Settings, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  conversations: { id: string; title: string | null; updatedAt: Date }[];
  onNewChat: () => void;
}

export function Sidebar({ conversations, onNewChat }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface">
      {/* Header */}
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/chat" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            Jarvis
          </span>
        </Link>
        <button
          onClick={onNewChat}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          title="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Conversations */}
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
                    "group flex items-center gap-2 truncate rounded-lg px-3 py-2 text-[13px] transition-all duration-150",
                    isActive
                      ? "bg-surface-raised text-foreground"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  )}
                >
                  {isActive && (
                    <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                  )}
                  <span className="truncate">{conv.title || "Untitled"}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="border-t border-border p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href === "/chat" && pathname.startsWith("/chat/")) ||
            (item.href === "/settings" && pathname.startsWith("/settings"));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all duration-150",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4", isActive && "text-accent")} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
