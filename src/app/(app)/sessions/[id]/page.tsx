"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  GitBranch,
  Cpu,
  Zap,
  Clock,
  Terminal,
  Bot,
  User,
  ChevronDown,
  ChevronRight,
  Check,
  Circle,
  Loader2,
  AlertCircle,
  Network,
  ArrowUpRight,
  MessageSquare,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type {
  SessionDetailResponse,
  TimelineEntry,
  SubAgentInfo,
} from "@/lib/claude/types";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
        status === "active" &&
          "border-green/20 bg-green/10 text-green",
        status === "idle" &&
          "border-accent/20 bg-accent/10 text-accent",
        status === "completed" &&
          "border-border bg-surface-raised text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "active" && "bg-green animate-pulse-glow",
          status === "idle" && "bg-accent",
          status === "completed" && "bg-muted"
        )}
      />
      {status}
    </span>
  );
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === "completed")
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green/10">
        <Check className="h-3 w-3 text-green" />
      </div>
    );
  if (status === "in_progress")
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10">
        <Loader2 className="h-3 w-3 text-accent animate-spin" />
      </div>
    );
  return (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-raised">
      <Circle className="h-3 w-3 text-muted" />
    </div>
  );
}

function TimelineItem({ entry, index }: { entry: TimelineEntry; index: number }) {
  const time = format(new Date(entry.timestamp), "HH:mm:ss");

  const kindConfig = {
    user: {
      icon: User,
      color: "text-blue-400",
      borderColor: "border-blue-400/20",
      bg: "bg-blue-400/5",
      label: "User",
    },
    assistant: {
      icon: Bot,
      color: "text-foreground",
      borderColor: "border-accent/10",
      bg: "bg-accent/[0.03]",
      label: "Claude",
    },
    tool_use: {
      icon: Terminal,
      color: "text-accent",
      borderColor: "border-border",
      bg: "bg-surface-raised/50",
      label: "Tool",
    },
    tool_result: {
      icon: Check,
      color: "text-green",
      borderColor: "border-border",
      bg: "bg-transparent",
      label: "Result",
    },
    sub_agent: {
      icon: Network,
      color: "text-purple-400",
      borderColor: "border-purple-400/20",
      bg: "bg-purple-400/5",
      label: "Agent",
    },
    error: {
      icon: AlertCircle,
      color: "text-red",
      borderColor: "border-red/20",
      bg: "bg-red/5",
      label: "Error",
    },
  };

  const config = entry.isError
    ? kindConfig.error
    : kindConfig[entry.kind] || kindConfig.assistant;
  const Icon = config.icon;

  return (
    <div
      className="animate-timeline-in flex gap-3 group"
      style={{ animationDelay: `${Math.min(index * 15, 600)}ms` }}
    >
      {/* Timeline column */}
      <div className="flex flex-col items-center pt-2.5">
        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            config.borderColor,
            config.bg
          )}
        >
          <Icon className={cn("h-3 w-3", config.color)} />
        </div>
        <div className="mt-1 w-px flex-1 bg-border/40" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex items-center gap-2 pt-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
            {config.label}
          </span>
          <span className="font-mono text-[10px] text-muted/60">
            {time}
          </span>
        </div>
        <p
          className={cn(
            "mt-1 font-mono text-[11px] leading-relaxed break-words",
            entry.isError ? "text-red" : "text-muted-foreground",
            entry.kind === "user" && "text-foreground font-sans text-[12px]",
            entry.kind === "assistant" && "font-sans text-[12px]",
            entry.kind === "tool_result" && !entry.isError && "text-muted"
          )}
        >
          {entry.text}
        </p>
      </div>
    </div>
  );
}

function SubAgentCard({
  agent,
  sessionId,
  projectDir,
  index,
}: {
  agent: SubAgentInfo;
  sessionId: string;
  projectDir: string;
  index: number;
}) {
  const total =
    agent.tokenUsage.inputTokens +
    agent.tokenUsage.outputTokens +
    agent.tokenUsage.cacheReadTokens +
    agent.tokenUsage.cacheCreationTokens;
  const href = `/sessions/${sessionId}?project=${encodeURIComponent(projectDir)}&subagent=${agent.agentId}`;

  return (
    <Link href={href}>
      <div
        className="animate-slide-up group flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5 transition-all hover:border-purple-400/30 hover:bg-purple-400/[0.03]"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-purple-400/20 bg-purple-400/10">
              <Network className="h-2.5 w-2.5 text-purple-400" />
            </div>
            <span className="font-mono text-[11px] font-semibold text-foreground">
              {agent.agentId.slice(0, 8)}
            </span>
            {agent.model && (
              <span className="rounded border border-border bg-surface-raised px-1.5 py-px text-[9px] font-medium text-muted">
                {agent.model}
              </span>
            )}
            <ArrowUpRight className="h-3 w-3 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          {agent.prompt && (
            <p className="mt-1 pl-7 text-[11px] leading-relaxed text-muted line-clamp-2">
              {agent.prompt}
            </p>
          )}
        </div>
        <div className="ml-3 shrink-0 text-right space-y-0.5">
          <div className="flex items-center justify-end gap-1 font-mono text-[10px] text-muted">
            <Zap className="h-2.5 w-2.5" />
            {formatTokens(total)}
          </div>
          <div className="flex items-center justify-end gap-1 font-mono text-[10px] text-muted">
            <MessageSquare className="h-2.5 w-2.5" />
            {agent.messageCount}
          </div>
        </div>
      </div>
    </Link>
  );
}

function CollapsibleSection({
  title,
  count,
  icon: Icon,
  iconColor,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        {title}
        <span className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[10px] font-medium text-muted">
          {count}
        </span>
        <div className="flex-1 border-t border-border/30" />
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted" />
        )}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

function TokenStat({
  label,
  value,
  total,
  color,
  delay,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  delay: number;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;

  return (
    <div
      className="animate-scale-in space-y-2 rounded-lg border border-border bg-surface px-4 py-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          {label}
        </span>
        <span className="font-mono text-[10px] text-muted">
          {pct.toFixed(0)}%
        </span>
      </div>
      <p className="font-mono text-xl font-bold tracking-tight text-foreground">
        {formatTokens(value)}
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-surface-raised">
        <div
          className={cn("h-full rounded-full transition-all duration-700", color)}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
    </div>
  );
}

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const projectDir = searchParams.get("project");
  const subagentId = searchParams.get("subagent");

  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const parentHref = projectDir
    ? `/sessions/${params.id}?project=${encodeURIComponent(projectDir)}`
    : "/sessions";

  useEffect(() => {
    if (!projectDir) {
      setError("Missing project parameter");
      setLoading(false);
      return;
    }

    setLoading(true);

    const fetchDetail = async () => {
      try {
        let url = `/api/agents/sessions/${params.id}?project=${encodeURIComponent(projectDir)}`;
        if (subagentId) url += `&subagent=${encodeURIComponent(subagentId)}`;
        const res = await fetch(url);
        if (res.ok) {
          setData(await res.json());
          setError(null);
        } else {
          setError("Session not found");
        }
      } catch {
        setError("Failed to load session");
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();

    const interval = setInterval(fetchDetail, 8000);
    return () => clearInterval(interval);
  }, [params.id, projectDir, subagentId]);

  if (loading) {
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

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface border border-border">
          <AlertCircle className="h-5 w-5 text-muted" />
        </div>
        <p className="text-sm text-muted-foreground">
          {error || "Session not found"}
        </p>
        <Link
          href="/sessions"
          className="inline-flex items-center gap-1.5 text-[12px] text-accent transition-colors hover:text-accent-dim"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Sessions
        </Link>
      </div>
    );
  }

  const { session, timeline, subAgents, tasks } = data;
  const totalTokens =
    session.totalTokens.inputTokens +
    session.totalTokens.outputTokens +
    session.totalTokens.cacheReadTokens +
    session.totalTokens.cacheCreationTokens;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        {/* Back link + header */}
        <div className="animate-fade-in space-y-4">
          <Link
            href={subagentId ? parentHref : "/sessions"}
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground group"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
            {subagentId ? "Back to Parent Session" : "Back to Sessions"}
          </Link>

          <div className="space-y-3">
            {/* Title row */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {session.projectName}
                </h1>
                {session.slug && (
                  <p className="mt-1 font-mono text-[12px] text-muted">
                    {session.slug}
                  </p>
                )}
              </div>
              <StatusBadge status={session.status} />
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
              {session.model && (
                <span className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  {session.model}
                </span>
              )}
              {session.gitBranch && (
                <span className="flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5" />
                  <span className="font-mono">{session.gitBranch}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Started{" "}
                {formatDistanceToNow(new Date(session.created), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Token stats with proportional bars */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TokenStat
            label="Input"
            value={session.totalTokens.inputTokens}
            total={totalTokens}
            color="bg-blue-400"
            delay={0}
          />
          <TokenStat
            label="Output"
            value={session.totalTokens.outputTokens}
            total={totalTokens}
            color="bg-accent"
            delay={60}
          />
          <TokenStat
            label="Cache"
            value={
              session.totalTokens.cacheReadTokens +
              session.totalTokens.cacheCreationTokens
            }
            total={totalTokens}
            color="bg-purple-400"
            delay={120}
          />
          <div
            className="animate-scale-in space-y-2 rounded-lg border border-accent/20 bg-gradient-to-br from-accent/[0.05] to-surface px-4 py-3"
            style={{ animationDelay: "180ms" }}
          >
            <div className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-accent" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                Total
              </span>
            </div>
            <p className="font-mono text-xl font-bold tracking-tight text-accent">
              {formatTokens(totalTokens)}
            </p>
            <div className="h-1 rounded-full bg-accent/20">
              <div className="h-full w-full rounded-full bg-accent" />
            </div>
          </div>
        </div>

        {/* Sub-agents */}
        {subAgents.length > 0 && (
          <div className="animate-fade-in rounded-xl border border-border bg-surface p-4">
            <CollapsibleSection
              title="Sub-Agents"
              count={subAgents.length}
              icon={Network}
              iconColor="text-purple-400"
              defaultOpen={true}
            >
              <div className="mt-2 space-y-2">
                {subAgents.map((agent, idx) => (
                  <SubAgentCard
                    key={agent.agentId}
                    agent={agent}
                    sessionId={params.id}
                    projectDir={projectDir!}
                    index={idx}
                  />
                ))}
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* Tasks */}
        {tasks.length > 0 && (
          <div className="animate-fade-in rounded-xl border border-border bg-surface p-4">
            <CollapsibleSection
              title="Tasks"
              count={tasks.length}
              icon={Check}
              iconColor="text-green"
              defaultOpen={true}
            >
              <div className="mt-2 space-y-0.5">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-hover"
                  >
                    <TaskStatusIcon status={task.status} />
                    <span
                      className={cn(
                        "text-[12px] leading-relaxed",
                        task.status === "completed"
                          ? "text-muted-foreground line-through decoration-border"
                          : "text-foreground"
                      )}
                    >
                      {task.subject}
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* Timeline */}
        <div className="animate-fade-in rounded-xl border border-border bg-surface p-4">
          <CollapsibleSection
            title="Timeline"
            count={timeline.length}
            icon={Clock}
            iconColor="text-muted-foreground"
            defaultOpen={true}
          >
            <div className="mt-3">
              {[...timeline].reverse().map((entry, idx) => (
                <TimelineItem key={idx} entry={entry} index={idx} />
              ))}
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
