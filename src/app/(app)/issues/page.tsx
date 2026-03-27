"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Settings2,
  Loader2,
  ArrowRight,
  ExternalLink,
  Plus,
  Trash2,
  Archive,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PHASE_LABELS, STATUS_DISPLAY_NAMES } from "@/lib/issues/phase-labels";

interface Issue {
  id: string;
  repositoryId: string;
  repositoryName: string | null;
  title: string;
  status: string;
  currentPhase: number;
  prUrl: string | null;
  prStatus: string | null;
  error: string | null;
  hasWorktree: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

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

const PR_STATUS_COLOR: Record<string, string> = {
  open: "text-green",
  merged: "text-purple-400",
  closed: "text-red",
};

type FilterTab = "all" | "active" | "completed" | "failed" | "archived";

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  const label = STATUS_DISPLAY_NAMES[status] || status.replace(/_/g, " ");
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

function IssueCard({ issue, index, onArchive }: { issue: Issue; index: number; onArchive?: (id: string) => void }) {
  const created = formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true });
  const canArchive = onArchive && (issue.status === "completed" || issue.status === "failed");

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
                ? "completed"
                : issue.status === "failed"
                  ? "failed"
                  : issue.currentPhase > 0
                    ? `${PHASE_LABELS[issue.currentPhase] || `phase ${issue.currentPhase}`}`
                    : "pending"}
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
                {issue.prStatus && (
                  <span className={`ml-0.5 text-[10px] ${PR_STATUS_COLOR[issue.prStatus] ?? "text-muted"}`}>
                    ({issue.prStatus})
                  </span>
                )}
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
            <div className="flex items-center gap-2">
              {canArchive && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onArchive(issue.id); }}
                  className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                  title="Archive"
                >
                  <Archive className="h-3 w-3" />
                  archive
                </button>
              )}
              <span className="flex items-center gap-1 text-[13px] text-muted opacity-0 group-hover:opacity-100 group-hover:text-accent transition-all">
                details <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [archivedIssues, setArchivedIssues] = useState<Issue[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [cleanAllState, setCleanAllState] = useState<"idle" | "confirming" | "cleaning">("idle");
  const [archiveAllState, setArchiveAllState] = useState<"idle" | "confirming" | "archiving">("idle");
  const [cleanResult, setCleanResult] = useState<string | null>(null);
  const [archiveResult, setArchiveResult] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const archiveConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const worktreeCount = issues.filter(
    (i) => i.hasWorktree && (i.status === "completed" || i.status === "failed")
  ).length;

  const archivableCount = issues.filter(
    (i) => i.status === "completed" || i.status === "failed"
  ).length;

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

  const fetchArchivedCount = useCallback(async () => {
    try {
      const res = await fetch("/api/issues?archived=true&countOnly=true");
      if (res.ok) {
        const data = await res.json();
        setArchivedCount(data.count);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchArchivedIssues = useCallback(async () => {
    setArchivedLoading(true);
    try {
      const res = await fetch("/api/issues?archived=true");
      if (res.ok) {
        const data = await res.json();
        setArchivedIssues(data.issues);
      }
    } catch { /* ignore */ } finally {
      setArchivedLoading(false);
    }
  }, []);

  const handleArchiveOne = useCallback(async (issueId: string) => {
    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (res.ok) {
        await Promise.all([fetchIssues(), fetchArchivedCount()]);
      }
    } catch { /* ignore */ }
  }, [fetchIssues, fetchArchivedCount]);

  const handleCleanAll = useCallback(async () => {
    if (cleanAllState === "idle") {
      setCleanAllState("confirming");
      confirmTimer.current = setTimeout(() => setCleanAllState("idle"), 3000);
      return;
    }
    if (cleanAllState === "confirming") {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setCleanAllState("cleaning");
      try {
        const res = await fetch("/api/issues/cleanup", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          const msg = data.errors?.length
            ? `cleaned ${data.cleaned} worktrees (${data.errors.length} failed)`
            : `cleaned ${data.cleaned} worktrees`;
          setCleanResult(msg);
          setTimeout(() => setCleanResult(null), 3000);
        }
      } catch {
        setCleanResult("cleanup failed");
        setTimeout(() => setCleanResult(null), 3000);
      } finally {
        setCleanAllState("idle");
        fetchIssues();
      }
    }
  }, [cleanAllState, fetchIssues]);

  const handleArchiveAll = useCallback(async () => {
    if (archiveAllState === "idle") {
      setArchiveAllState("confirming");
      archiveConfirmTimer.current = setTimeout(() => setArchiveAllState("idle"), 3000);
      return;
    }
    if (archiveAllState === "confirming") {
      if (archiveConfirmTimer.current) clearTimeout(archiveConfirmTimer.current);
      setArchiveAllState("archiving");
      try {
        const res = await fetch("/api/issues/archive", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          setArchiveResult(`archived ${data.archived} issues`);
          setTimeout(() => setArchiveResult(null), 3000);
        }
      } catch {
        setArchiveResult("archive failed");
        setTimeout(() => setArchiveResult(null), 3000);
      } finally {
        setArchiveAllState("idle");
        await Promise.all([fetchIssues(), fetchArchivedCount()]);
      }
    }
  }, [archiveAllState, fetchIssues, fetchArchivedCount]);

  // Initial load: fetch issues + archived count
  useEffect(() => { fetchIssues(); fetchArchivedCount(); }, [fetchIssues, fetchArchivedCount]);

  // Fetch archived issues when switching to the archived tab
  useEffect(() => {
    if (filter === "archived") {
      fetchArchivedIssues();
    }
  }, [filter, fetchArchivedIssues]);

  // Auto-refresh while any issue is in progress (non-archived only)
  useEffect(() => {
    const hasActive = issues.some((i) =>
      !["pending", "completed", "failed"].includes(i.status)
    );
    if (!hasActive) return;

    const interval = setInterval(fetchIssues, 5000);
    return () => clearInterval(interval);
  }, [issues, fetchIssues]);

  const displayIssues = filter === "archived" ? archivedIssues : issues;
  const filtered = displayIssues.filter((issue) => {
    if (filter === "all" || filter === "archived") return true;
    if (filter === "active") return !["completed", "failed", "pending"].includes(issue.status);
    if (filter === "completed") return issue.status === "completed";
    if (filter === "failed") return issue.status === "failed";
    return true;
  });

  const filterTabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: issues.length },
    { key: "active", label: "In Progress", count: issues.filter((i) => !["completed", "failed", "pending"].includes(i.status)).length },
    { key: "completed", label: "Completed", count: issues.filter((i) => i.status === "completed").length },
    { key: "failed", label: "Failed", count: issues.filter((i) => i.status === "failed").length },
    { key: "archived", label: "Archived", count: archivedCount },
  ];

  const isShowingArchived = filter === "archived";

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
                // track and manage issues
              </p>
            </div>
            <div className="flex items-center gap-2">
              {cleanResult && (
                <span className="text-[12px] font-mono text-green animate-fade-in">
                  {cleanResult}
                </span>
              )}
              {archiveResult && (
                <span className="text-[12px] font-mono text-green animate-fade-in">
                  {archiveResult}
                </span>
              )}
              {archivableCount > 0 && !isShowingArchived && (
                <button
                  onClick={handleArchiveAll}
                  disabled={archiveAllState === "archiving"}
                  className={`flex h-8 items-center gap-1.5 border px-3 text-[13px] font-mono transition-all ${
                    archiveAllState === "confirming"
                      ? "border-accent/50 bg-accent/10 text-accent hover:bg-accent/20"
                      : archiveAllState === "archiving"
                        ? "border-border bg-surface text-muted-foreground cursor-wait"
                        : "border-border bg-surface text-muted-foreground hover:border-accent/50 hover:text-accent"
                  }`}
                >
                  {archiveAllState === "archiving" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                  {archiveAllState === "confirming"
                    ? "confirm?"
                    : archiveAllState === "archiving"
                      ? "archiving..."
                      : `archive done (${archivableCount})`}
                </button>
              )}
              {worktreeCount > 0 && !isShowingArchived && (
                <button
                  onClick={handleCleanAll}
                  disabled={cleanAllState === "cleaning"}
                  className={`flex h-8 items-center gap-1.5 border px-3 text-[13px] font-mono transition-all ${
                    cleanAllState === "confirming"
                      ? "border-red/50 bg-red/10 text-red hover:bg-red/20"
                      : cleanAllState === "cleaning"
                        ? "border-border bg-surface text-muted-foreground cursor-wait"
                        : "border-border bg-surface text-muted-foreground hover:border-red/50 hover:text-red"
                  }`}
                >
                  {cleanAllState === "cleaning" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  {cleanAllState === "confirming"
                    ? "confirm?"
                    : cleanAllState === "cleaning"
                      ? "cleaning..."
                      : `clean worktrees (${worktreeCount})`}
                </button>
              )}
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
        {(loading || (isShowingArchived && archivedLoading)) && (
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
        {!loading && !error && issues.length === 0 && !isShowingArchived && (
          <div className="animate-fade-in flex flex-col items-center justify-center py-24 text-center">
            <div className="text-[14px] font-mono text-muted-foreground space-y-1">
              <p className="text-muted">No issues found</p>
              {archivedCount > 0 ? (
                <p className="text-muted-foreground">
                  All issues archived &mdash; check the{" "}
                  <button onClick={() => setFilter("archived")} className="text-accent hover:underline">
                    Archived
                  </button>{" "}
                  tab
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground">No issues yet</p>
                  <p className="text-muted mt-4">
                    Configure a repository in{" "}
                    <Link href="/issues/config" className="text-accent hover:underline">config</Link>
                    {" "}then send <code className="text-accent">/issue RepoName: description</code> via Telegram
                  </p>
                </>
              )}
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
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  index={idx}
                  onArchive={!isShowingArchived ? handleArchiveOne : undefined}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
