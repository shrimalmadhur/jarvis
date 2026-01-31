"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Activity,
  GitBranch,
  Cpu,
  Zap,
  Clock,
  Terminal,
  Bot,
  Play,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { AgentSession, AgentStatusResponse } from "@/lib/claude/types";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function totalTokens(session: AgentSession): number {
  const t = session.tokenUsage;
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens;
}

function StatusIndicator({ status }: { status: AgentSession["status"] }) {
  return (
    <span className="relative flex items-center">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "active" && "bg-green animate-pulse-glow",
          status === "idle" && "bg-accent",
          status === "completed" && "bg-muted"
        )}
      />
      {status === "active" && (
        <span className="absolute h-2 w-2 rounded-full bg-green/40 animate-ping" />
      )}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon,
  delay,
  accent,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  delay: number;
  accent?: boolean;
}) {
  return (
    <div
      className="animate-scale-in group relative overflow-hidden rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-hover"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "mt-1.5 font-mono text-2xl font-bold tracking-tight",
          accent ? "text-accent" : "text-foreground"
        )}
      >
        {value}
      </p>
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

function AgentCard({ session, index }: { session: AgentSession; index: number }) {
  const timeAgo = formatDistanceToNow(new Date(session.lastActivity), {
    addSuffix: true,
  });
  const detailHref = `/agents/${session.sessionId}?project=${encodeURIComponent(session.projectDir)}`;
  const tokens = totalTokens(session);

  return (
    <Link href={detailHref} className="block group">
      <div
        className={cn(
          "animate-slide-up relative overflow-hidden rounded-xl border transition-all duration-300",
          "hover:border-border-hover hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5",
          session.status === "active" &&
            "border-green/20 bg-gradient-to-b from-green/[0.03] to-surface animate-shimmer",
          session.status === "idle" &&
            "border-accent/10 bg-surface",
          session.status === "completed" &&
            "border-border bg-surface opacity-60 hover:opacity-80"
        )}
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="relative z-10 p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <StatusIndicator status={session.status} />
                <span className="text-[13px] font-semibold text-foreground truncate">
                  {session.projectName}
                </span>
              </div>
              {session.slug && (
                <p className="mt-1 pl-[18px] font-mono text-[10px] text-muted leading-relaxed truncate">
                  {session.slug}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted">
              <Clock className="h-3 w-3" />
              {timeAgo}
            </div>
          </div>

          {/* Last action */}
          {session.lastAction && (
            <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-2">
              <div className="flex items-start gap-2">
                {session.lastToolName ? (
                  <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                ) : (
                  <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <p className="font-mono text-[11px] leading-relaxed text-muted-foreground break-all line-clamp-2">
                  {session.lastAction}
                </p>
              </div>
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center justify-between pt-0.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
              {session.model && (
                <span className="flex items-center gap-1">
                  <Cpu className="h-3 w-3" />
                  {session.model}
                </span>
              )}
              {session.gitBranch && (
                <span className="flex items-center gap-1 truncate max-w-[130px]">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="truncate font-mono">{session.gitBranch}</span>
                </span>
              )}
              <span className="flex items-center gap-1 font-mono">
                <Zap className="h-3 w-3" />
                {formatTokens(tokens)}
              </span>
              <span className="flex items-center gap-1 font-mono">
                <MessageSquare className="h-3 w-3" />
                {session.messageCount}
              </span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </h2>
      <span className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[10px] text-muted">
        {count}
      </span>
      <div className="flex-1 border-t border-border/40" />
    </div>
  );
}

export default function AgentsPage() {
  const [data, setData] = useState<AgentStatusResponse | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/agents/status");
        if (res.ok) {
          setData(await res.json());
          setError(null);
        } else {
          setError("Failed to fetch agent status");
        }
      } catch {
        setError("Could not connect to server");
      }
    };

    fetchStatus();
    if (!isPolling) return;

    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [isPolling]);

  const activeSessions = data?.sessions.filter((s) => s.status === "active") ?? [];
  const idleSessions = data?.sessions.filter((s) => s.status === "idle") ?? [];
  const completedSessions = data?.sessions.filter((s) => s.status === "completed") ?? [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Header */}
        <div className="animate-fade-in flex items-end justify-between gap-4 pb-2">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
                <Activity className="h-4.5 w-4.5 text-accent" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-foreground">
                  Agent Monitor
                </h1>
                <p className="text-[11px] text-muted">
                  Live Claude Code sessions across all projects
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsPolling(!isPolling)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all",
              isPolling
                ? "border-green/20 bg-green/5 text-green hover:bg-green/10"
                : "border-border text-muted-foreground hover:border-border-hover hover:text-foreground"
            )}
          >
            {isPolling ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
                </span>
                Live
              </>
            ) : (
              <>
                <Play className="h-3 w-3" /> Paused
              </>
            )}
          </button>
        </div>

        {/* Summary stats */}
        {data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Active"
              value={data.summary.activeCount}
              icon={<span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse-glow" />}
              delay={0}
            />
            <StatCard
              label="Idle"
              value={data.summary.idleCount}
              icon={<span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              delay={60}
            />
            <StatCard
              label="Completed"
              value={data.summary.completedCount}
              icon={<span className="h-1.5 w-1.5 rounded-full bg-muted" />}
              delay={120}
            />
            <StatCard
              label="Tokens Today"
              value={formatTokens(data.summary.totalTokensToday)}
              icon={<Zap className="h-3 w-3 text-accent" />}
              delay={180}
              accent
            />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="animate-fade-in rounded-lg border border-red/20 bg-red/5 px-4 py-3 text-[12px] text-red">
            {error}
          </div>
        )}

        {/* Empty state */}
        {data && data.sessions.length === 0 && (
          <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface border border-border">
              <Activity className="h-6 w-6 text-muted" />
            </div>
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              No active agents detected
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Claude Code CLI sessions will appear here automatically
            </p>
          </div>
        )}

        {/* Active agents */}
        {activeSessions.length > 0 && (
          <div className="space-y-4">
            <SectionHeader title="Active" count={activeSessions.length} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activeSessions.map((session, idx) => (
                <AgentCard
                  key={session.sessionId}
                  session={session}
                  index={idx}
                />
              ))}
            </div>
          </div>
        )}

        {/* Idle agents */}
        {idleSessions.length > 0 && (
          <div className="space-y-4">
            <SectionHeader title="Idle" count={idleSessions.length} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {idleSessions.map((session, idx) => (
                <AgentCard
                  key={session.sessionId}
                  session={session}
                  index={idx}
                />
              ))}
            </div>
          </div>
        )}

        {/* Completed agents */}
        {completedSessions.length > 0 && (
          <div className="space-y-4">
            <SectionHeader title="Recently Completed" count={completedSessions.length} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {completedSessions.map((session, idx) => (
                <AgentCard
                  key={session.sessionId}
                  session={session}
                  index={idx}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
