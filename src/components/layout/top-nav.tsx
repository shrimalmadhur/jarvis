"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  Settings,
  Plus,
  FolderKanban,
  Terminal,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/sessions", label: "Sessions", icon: Terminal },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface TopNavProps {
  onNewChat: () => void;
}

export function TopNav({ onNewChat }: TopNavProps) {
  const pathname = usePathname();
  const isOnChat =
    pathname === "/chat" || pathname.startsWith("/chat/");

  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("dobby-theme");
    if (saved === "light") {
      setTheme("light");
      document.documentElement.classList.add("light");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("dobby-theme", next);
    if (next === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  return (
    <nav className="flex h-14 shrink-0 items-center border-b border-border bg-surface/80 backdrop-blur-sm px-6">
      {/* Brand */}
      <Link href="/chat" className="flex items-center gap-3 mr-8">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent shadow-sm shadow-accent/20">
          <span className="text-[13px] font-bold text-accent-foreground">D</span>
        </div>
        <span className="text-[17px] font-semibold tracking-tight text-foreground">
          Dobby
        </span>
      </Link>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href === "/chat" && pathname.startsWith("/chat/")) ||
            (item.href === "/projects" && pathname.startsWith("/projects")) ||
            (item.href === "/sessions" && pathname.startsWith("/sessions")) ||
            (item.href === "/settings" && pathname.startsWith("/settings"));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-[14px] font-medium transition-all duration-150",
                isActive
                  ? "bg-accent/12 text-accent"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Status */}
      <div className="flex items-center gap-2.5 mr-5">
        <span className="h-2 w-2 rounded-full bg-green status-dot-live" />
        <span className="text-[13px] text-muted-foreground">Online</span>
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-all hover:text-foreground hover:bg-surface-hover hover:border-border-hover mr-3"
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* New Chat */}
      {isOnChat && (
        <button
          onClick={onNewChat}
          className="flex h-8 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-foreground transition-all hover:bg-accent-dim shadow-sm shadow-accent/20"
          title="New chat"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>
      )}
    </nav>
  );
}
