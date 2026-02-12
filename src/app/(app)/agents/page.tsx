"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Bot,
  Clock,
  Cpu,
  ChevronRight,
  Check,
  AlertCircle,
  Globe,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CronAgent {
  name: string;
  enabled: boolean;
  schedule: string;
  scheduleHuman: string;
  timezone: string | null;
  model: string | null;
  provider: string | null;
  soulExcerpt: string;
  lastRun: {
    status: string;
    createdAt: string | null;
    durationMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    error: string | null;
  } | null;
}

function AgentCard({ agent, index }: { agent: CronAgent; index: number }) {
  const lastRunTime = agent.lastRun?.createdAt
    ? formatDistanceToNow(new Date(agent.lastRun.createdAt), { addSuffix: true })
    : null;
  const duration = agent.lastRun?.durationMs
    ? agent.lastRun.durationMs < 1000
      ? `${agent.lastRun.durationMs}ms`
      : `${(agent.lastRun.durationMs / 1000).toFixed(1)}s`
    : null;

  return (
    <Link href={`/agents/${agent.name}`} className="block group">
      <div
        className={cn(
          "animate-slide-up relative overflow-hidden rounded-xl border transition-all duration-300",
          "hover:border-border-hover hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5",
          agent.enabled
            ? "border-border bg-surface"
            : "border-border bg-surface opacity-50 hover:opacity-70"
        )}
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="relative z-10 p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
                <Bot className="h-4 w-4 text-accent" />
              </div>
              <div className="min-w-0">
                <span className="text-[13px] font-semibold text-foreground truncate block">
                  {agent.name}
                </span>
              </div>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]",
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

          {/* Soul excerpt */}
          <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
            {agent.soulExcerpt}
          </p>

          {/* Schedule + Model */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {agent.scheduleHuman}
            </span>
            {agent.timezone && (
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {agent.timezone}
              </span>
            )}
            {agent.model && (
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                {agent.model}
              </span>
            )}
          </div>

          {/* Last run */}
          <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
            {agent.lastRun ? (
              <div className="flex items-center gap-2 text-[10px]">
                {agent.lastRun.status === "success" ? (
                  <span className="flex items-center gap-1 text-green">
                    <Check className="h-3 w-3" />
                    Success
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red">
                    <AlertCircle className="h-3 w-3" />
                    Error
                  </span>
                )}
                {lastRunTime && (
                  <span className="text-muted">{lastRunTime}</span>
                )}
                {duration && (
                  <span className="font-mono text-muted">{duration}</span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-muted">No runs yet</span>
            )}
            <ChevronRight className="h-3.5 w-3.5 text-muted opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<CronAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch("/api/cron-agents");
        if (res.ok) {
          const data = await res.json();
          setAgents(data.agents);
        } else {
          setError("Failed to load agents");
        }
      } catch {
        setError("Could not connect to server");
      } finally {
        setLoading(false);
      }
    }
    fetchAgents();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Header */}
        <div className="animate-fade-in pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
              <Bot className="h-4.5 w-4.5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                Agents
              </h1>
              <p className="text-[11px] text-muted">
                Installed cron agents
              </p>
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-1">
              <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
              <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
              <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="animate-fade-in rounded-lg border border-red/20 bg-red/5 px-4 py-3 text-[12px] text-red">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && agents.length === 0 && (
          <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface border border-border">
              <Bot className="h-6 w-6 text-muted" />
            </div>
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              No agents configured
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Add agent definitions to the agents/ directory
            </p>
          </div>
        )}

        {/* Agent grid */}
        {agents.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent, idx) => (
              <AgentCard key={agent.name} agent={agent} index={idx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
