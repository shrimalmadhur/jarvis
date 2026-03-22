"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Settings2,
  Loader2,
  ArrowRight,
  ExternalLink,
  Plus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Issue {
  id: string;
  repositoryId: string;
  repositoryName: string | null;
  title: string;
  status: string;
  currentPhase: number;
  prUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const PHASE_LABELS = [
  "Pending",
  "Planning",
  "Review #1",
  "Review #2",
  "Implementing",
  "Code Review #1",
  "Code Review #2",
  "Creating PR",
];

const STATUS_STYLES: Record<string, { bg: string; text: string; dot?: string }> = {
  pending: { bg: "bg-muted/10", text: "text-muted-foreground" },
  planning: { bg: "bg-accent/10", text: "text-accent", dot: "bg-accent animate-pulse" },
  reviewing_plan_1: { bg: "bg-accent/10", text: "text-accent", dot: "bg-accent animate-pulse" },
  reviewing_plan_2: { bg: "bg-accent/10", text: "text-accent", dot: "bg-accent animate-pulse" },
  implementing: { bg: "bg-blue-500/10", text: "text-blue-400", dot: "bg-blue-400 animate-pulse" },
  reviewing_code_1: { bg: "bg-accent/10", text: "text-accent", dot: "bg-accent animate-pulse" },
  reviewing_code_2: { bg: "bg-accent/10", text: "text-accent", dot: "bg-accent animate-pulse" },
  creating_pr: { bg: "bg-accent/10", text: "text-accent", dot: "bg-accent animate-pulse" },
  completed: { bg: "bg-green/10", text: "text-green" },
  failed: { bg: "bg-red/10", text: "text-red" },
  waiting_for_input: { bg: "bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-400 animate-pulse" },
};

type FilterTab = "all" | "active" | "completed" | "failed";

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  const label = status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider ${style.bg} ${style.text}`}>
      {style.dot && <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />}
      {label}
    </span>
  );
}

function PipelineProgress({ currentPhase, status }: { currentPhase: number; status: string }) {
  const isFailed = status === "failed";
  const isCompleted = status === "completed";
  const isWaiting = status === "waiting_for_input";

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 7 }, (_, i) => {
        const phase = i + 1;
        let dotClass = "h-1.5 w-1.5 rounded-full bg-border";

        if (isCompleted) {
          dotClass = "h-1.5 w-1.5 rounded-full bg-green";
        } else if (isFailed && phase === currentPhase) {
          dotClass = "h-1.5 w-1.5 rounded-full bg-red";
        } else if (isWaiting && phase === currentPhase) {
          dotClass = "h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse";
        } else if (phase < currentPhase) {
          dotClass = "h-1.5 w-1.5 rounded-full bg-green";
        } else if (phase === currentPhase) {
          dotClass = "h-1.5 w-1.5 rounded-full bg-accent animate-pulse";
        }

        return <span key={i} className={dotClass} />;
      })}
    </div>
  );
}

function IssueCard({ issue, index }: { issue: Issue; index: number }) {
  const created = formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true });

  return (
    <Link href={`/issues/${issue.id}`} className="block group">
      <div
        className="animate-grid-reveal term-card relative overflow-hidden transition-all duration-200 hover:border-accent/40 hover:bg-surface-hover"
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="relative z-10 p-5 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-accent text-[14px]">&gt;</span>
                <span className="text-[15px] font-bold text-foreground tracking-wide truncate">
                  {issue.title}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <span className="text-[12px] text-muted font-mono">{issue.repositoryName}</span>
                <span className="text-border">|</span>
                <span className="text-[12px] text-muted font-mono">{created}</span>
              </div>
            </div>
            <StatusBadge status={issue.status} />
          </div>

          {/* Pipeline progress */}
          <div className="flex items-center gap-3 ml-4">
            <PipelineProgress currentPhase={issue.currentPhase} status={issue.status} />
            <span className="text-[11px] font-mono text-muted">
              {issue.status === "completed"
                ? "done"
                : issue.status === "failed"
                  ? "failed"
                  : issue.currentPhase > 0
                    ? `${PHASE_LABELS[issue.currentPhase] || `phase ${issue.currentPhase}`}`
                    : "queued"}
            </span>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            {issue.prUrl ? (
              <a
                href={issue.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[12px] font-mono text-accent hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
                PR
              </a>
            ) : issue.error ? (
              <span className="text-[12px] font-mono text-red truncate max-w-[200px]">
                {issue.error.substring(0, 50)}
              </span>
            ) : (
              <span className="text-[12px] font-mono text-muted">
                {issue.id.substring(0, 8)}
              </span>
            )}
            <span className="flex items-center gap-1 text-[13px] text-muted opacity-0 group-hover:opacity-100 group-hover:text-accent transition-all">
              details <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");

  const fetchIssues = useCallback(async () => {
    try {
      const res = await fetch("/api/issues");
      if (res.ok) {
        const data = await res.json();
        setIssues(data.issues);
      } else {
        setError("Failed to load issues");
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIssues(); }, [fetchIssues]);

  // Auto-refresh while any issue is in progress
  useEffect(() => {
    const hasActive = issues.some((i) =>
      !["pending", "completed", "failed"].includes(i.status)
    );
    if (!hasActive) return;

    const interval = setInterval(fetchIssues, 5000);
    return () => clearInterval(interval);
  }, [issues, fetchIssues]);

  const filtered = issues.filter((issue) => {
    if (filter === "all") return true;
    if (filter === "active") return !["completed", "failed", "pending"].includes(issue.status);
    if (filter === "completed") return issue.status === "completed";
    if (filter === "failed") return issue.status === "failed";
    return true;
  });

  const filterTabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: issues.length },
    { key: "active", label: "Active", count: issues.filter((i) => !["completed", "failed", "pending"].includes(i.status)).length },
    { key: "completed", label: "Completed", count: issues.filter((i) => i.status === "completed").length },
    { key: "failed", label: "Failed", count: issues.filter((i) => i.status === "failed").length },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="page-header">
        <div className="px-8 lg:px-16">
          <div className="animate-fade-in flex items-end justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-accent text-[14px] glow-text">&gt;&gt;</span>
                <h1 className="text-[24px] font-bold tracking-widest text-foreground uppercase glow-text">
                  Issues
                </h1>
              </div>
              <p className="text-[14px] text-muted-foreground font-mono ml-6">
                // autonomous code implementation pipeline
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/issues/config"
                className="flex h-8 items-center gap-1.5 border border-border bg-surface px-3 text-[13px] font-mono text-muted-foreground transition-all hover:border-accent/50 hover:text-foreground"
              >
                <Settings2 className="h-3.5 w-3.5" />
                config
              </Link>
              <Link
                href="/issues/config"
                className="flex h-8 items-center gap-1.5 border border-accent/50 bg-accent/5 px-4 text-[14px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/15 hover:border-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                new issue
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 lg:px-16 py-8 space-y-6">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 border-b border-border/40 pb-1">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider transition-all ${
                filter === tab.key
                  ? "text-accent border-b-2 border-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex items-center gap-2 text-[14px] font-mono text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              loading issues...
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="animate-type-in border border-red/30 bg-red/5 px-4 py-2.5 text-[14px] font-mono text-red max-w-2xl">
            [ERROR] {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && issues.length === 0 && (
          <div className="animate-fade-in flex flex-col items-center justify-center py-24 text-center">
            <div className="text-[14px] font-mono text-muted-foreground space-y-1">
              <p className="text-muted">No issues yet...</p>
              <p className="text-muted-foreground">0 issues created</p>
              <p className="text-muted mt-4">
                Configure a repository in{" "}
                <Link href="/issues/config" className="text-accent hover:underline">config</Link>
                {" "}then send <code className="text-accent">/issue RepoName: description</code> via Telegram
              </p>
            </div>
          </div>
        )}

        {/* Issues grid */}
        {filtered.length > 0 && (
          <>
            <div className="text-[12px] font-mono text-muted uppercase tracking-wider">
              {filtered.length} {filtered.length !== 1 ? "issues" : "issue"}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((issue, idx) => (
                <IssueCard key={issue.id} issue={issue} index={idx} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
