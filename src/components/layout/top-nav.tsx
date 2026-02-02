"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  Settings,
  Plus,
  Sparkles,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/agents", label: "Agents", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface TopNavProps {
  onNewChat: () => void;
}

export function TopNav({ onNewChat }: TopNavProps) {
  const pathname = usePathname();
  const isOnChat =
    pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <nav className="flex h-12 shrink-0 items-center border-b border-border bg-surface px-4">
      {/* Brand */}
      <Link href="/chat" className="flex items-center gap-2 mr-6">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          Jarvis
        </span>
      </Link>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href === "/chat" && pathname.startsWith("/chat/")) ||
            (item.href === "/settings" && pathname.startsWith("/settings")) ||
            (item.href === "/agents" && pathname.startsWith("/agents"));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon
                className={cn("h-4 w-4", isActive && "text-accent")}
              />
              {item.label}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-accent" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* New Chat button - only on chat routes */}
      {isOnChat && (
        <button
          onClick={onNewChat}
          className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          title="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </button>
      )}
    </nav>
  );
}
