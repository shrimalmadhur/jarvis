"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Bot,
  Clock,
  Cpu,
  Globe,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Zap,
  FileText,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface AgentDetail {
  name: string;
  enabled: boolean;
  schedule: string;
  timezone: string | null;
  model: string | null;
  provider: string | null;
  temperature: number | null;
  maxTokens: number | null;
  soul: string;
  skill: string;
}

interface AgentRun {
  id: string;
  status: string;
  output: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string | null;
}

interface RunsResponse {
  runs: AgentRun[];
  total: number;
  limit: number;
  offset: number;
}

function CollapsibleSection({
  title,
  icon: Icon,
  iconColor,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        {title}
        <div className="flex-1" />
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/40 px-4 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

function RunItem({ run, index }: { run: AgentRun; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const time = run.createdAt
    ? format(new Date(run.createdAt), "MMM d, yyyy 'at' h:mm a")
    : "Unknown";
  const timeAgo = run.createdAt
    ? formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })
    : null;
  const duration = run.durationMs
    ? run.durationMs < 1000
      ? `${run.durationMs}ms`
      : `${(run.durationMs / 1000).toFixed(1)}s`
    : null;
  const tokens =
    (run.promptTokens || 0) + (run.completionTokens || 0);

  return (
    <div
      className="animate-slide-up border-b border-border/30 last:border-0"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        {/* Status icon */}
        <div className="mt-0.5">
          {run.status === "success" ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green/10">
              <Check className="h-3 w-3 text-green" />
            </div>
          ) : (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red/10">
              <AlertCircle className="h-3 w-3 text-red" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-foreground font-medium">{time}</span>
            {timeAgo && (
              <span className="text-muted">{timeAgo}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted">
            {duration && (
              <span className="font-mono">{duration}</span>
            )}
            {tokens > 0 && (
              <span className="flex items-center gap-1 font-mono">
                <Zap className="h-2.5 w-2.5" />
                {tokens.toLocaleString()}
              </span>
            )}
            {run.model && (
              <span className="flex items-center gap-1">
                <Cpu className="h-2.5 w-2.5" />
                {run.model}
              </span>
            )}
          </div>
          {/* Preview */}
          {!expanded && run.output && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
              {run.output}
            </p>
          )}
        </div>

        {/* Expand icon */}
        {(run.output || run.error) && (
          expanded ? (
            <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" />
          )
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pl-12">
          {run.error && (
            <div className="mb-3 rounded-lg border border-red/20 bg-red/5 px-3 py-2">
              <p className="text-[11px] font-medium text-red">Error</p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-red/80">
                {run.error}
              </p>
            </div>
          )}
          {run.output && (
            <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-2">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                {run.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentDetailPage() {
  const params = useParams<{ name: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [agentRes, runsRes] = await Promise.all([
          fetch(`/api/cron-agents/${params.name}`),
          fetch(`/api/cron-agents/${params.name}/runs?limit=20`),
        ]);

        if (!agentRes.ok) {
          setError("Agent not found");
          return;
        }

        setAgent(await agentRes.json());

        if (runsRes.ok) {
          const runsData: RunsResponse = await runsRes.json();
          setRuns(runsData.runs);
          setTotalRuns(runsData.total);
        }
      } catch {
        setError("Failed to load agent");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [params.name]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/cron-agents/${params.name}/runs?limit=20&offset=${runs.length}`
      );
      if (res.ok) {
        const data: RunsResponse = await res.json();
        setRuns((prev) => [...prev, ...data.runs]);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [params.name, runs.length]);

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

  if (error || !agent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface border border-border">
          <AlertCircle className="h-5 w-5 text-muted" />
        </div>
        <p className="text-sm text-muted-foreground">
          {error || "Agent not found"}
        </p>
        <Link
          href="/agents"
          className="inline-flex items-center gap-1.5 text-[12px] text-accent transition-colors hover:text-accent-dim"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Agents
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        {/* Back + Header */}
        <div className="animate-fade-in space-y-4">
          <Link
            href="/agents"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground group"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
            Back to Agents
          </Link>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 border border-accent/20">
                  <Bot className="h-5 w-5 text-accent" />
                </div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {agent.name}
                </h1>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
                  agent.enabled
                    ? "border-green/20 bg-green/10 text-green"
                    : "border-border bg-surface-raised text-muted"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    agent.enabled ? "bg-green" : "bg-muted"
                  )}
                />
                {agent.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {agent.schedule}
              </span>
              {agent.timezone && (
                <span className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  {agent.timezone}
                </span>
              )}
              {agent.model && (
                <span className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  {agent.model}
                </span>
              )}
              {agent.provider && (
                <span className="rounded border border-border bg-surface-raised px-1.5 py-px text-[9px] font-medium">
                  {agent.provider}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Soul / Skill */}
        <CollapsibleSection
          title="Personality (soul.md)"
          icon={Bot}
          iconColor="text-accent"
        >
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
            {agent.soul}
          </pre>
        </CollapsibleSection>

        <CollapsibleSection
          title="Task (skill.md)"
          icon={FileText}
          iconColor="text-accent"
        >
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
            {agent.skill}
          </pre>
        </CollapsibleSection>

        {/* Run History */}
        <div className="animate-fade-in rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              Run History
            </span>
            <span className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[10px] font-medium text-muted">
              {totalRuns}
            </span>
          </div>

          {runs.length === 0 ? (
            <div className="border-t border-border/40 px-4 py-8 text-center">
              <p className="text-[12px] text-muted">No runs recorded yet</p>
            </div>
          ) : (
            <div className="border-t border-border/40">
              {runs.map((run, idx) => (
                <RunItem key={run.id} run={run} index={idx} />
              ))}
            </div>
          )}

          {runs.length < totalRuns && (
            <div className="border-t border-border/40 px-4 py-3">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full rounded-lg border border-border px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : `Load More (${totalRuns - runs.length} remaining)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
