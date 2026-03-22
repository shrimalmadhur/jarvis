"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Loader2,
  ExternalLink,
  RotateCcw,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PIPELINE_PHASES } from "@/lib/issues/phase-labels";

interface IssueDetail {
  id: string;
  repositoryId: string;
  repositoryName: string;
  localRepoPath: string;
  title: string;
  description: string;
  status: string;
  currentPhase: number;
  prUrl: string | null;
  phaseSessionIds: Record<string, string> | null;
  planOutput: string | null;
  planReview1: string | null;
  planReview2: string | null;
  codeReview1: string | null;
  codeReview2: string | null;
  worktreePath: string | null;
  branchName: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  messages: { id: number; direction: string; message: string; createdAt: string }[];
}

const PHASES = PIPELINE_PHASES;

function PipelineBar({ currentPhase, status }: { currentPhase: number; status: string }) {
  const isFailed = status === "failed";
  const isCompleted = status === "completed";
  const isWaiting = status === "waiting_for_input";

  return (
    <div className="flex items-center gap-0">
      {PHASES.map(({ phase, label }, idx) => {
        let dotColor = "bg-border";
        let lineColor = "bg-border/40";
        let labelColor = "text-muted";

        if (isCompleted) {
          dotColor = "bg-green";
          lineColor = "bg-green/30";
          labelColor = "text-green";
        } else if (phase < currentPhase) {
          dotColor = "bg-green";
          lineColor = "bg-green/30";
          labelColor = "text-green";
        } else if (phase === currentPhase) {
          if (isFailed) {
            dotColor = "bg-red";
            labelColor = "text-red";
          } else if (isWaiting) {
            dotColor = "bg-amber-400 animate-pulse";
            labelColor = "text-amber-400";
          } else {
            dotColor = "bg-accent animate-pulse";
            labelColor = "text-accent";
          }
        }

        return (
          <div key={phase} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`h-3 w-3 rounded-full ${dotColor}`} />
              <span className={`text-[10px] font-mono ${labelColor} whitespace-nowrap`}>
                {label}
              </span>
            </div>
            {idx < PHASES.length - 1 && (
              <div className={`h-0.5 w-8 ${lineColor} -mt-4`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleSection({ title, content, defaultOpen }: { title: string; content: string | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  if (!content) return null;

  return (
    <div className="term-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-surface-hover transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-[13px] font-mono font-bold text-foreground uppercase tracking-wider">
          {title}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 prose prose-invert prose-sm max-w-none text-[14px] font-mono text-muted-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check className="h-3.5 w-3.5 text-green" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);

  const fetchIssue = useCallback(async () => {
    try {
      const res = await fetch(`/api/issues/${id}`);
      if (res.ok) {
        setIssue(await res.json());
      } else {
        setError("Quest not found on the map");
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchIssue(); }, [fetchIssue]);

  // Auto-refresh while in progress
  useEffect(() => {
    if (!issue || ["completed", "failed", "pending"].includes(issue.status)) return;
    const interval = setInterval(fetchIssue, 5000);
    return () => clearInterval(interval);
  }, [issue, fetchIssue]);

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/issues/${id}/retry`, { method: "POST" });
      if (res.ok) {
        await fetchIssue();
      }
    } catch { /* ignore */ } finally {
      setRetrying(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await fetch(`/api/issues/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "failed", error: "Cancelled by user" }),
      });
      await fetchIssue();
    } catch { /* ignore */ } finally {
      setCancelling(false);
    }
  }

  async function handleCleanup() {
    setCleaningUp(true);
    try {
      const res = await fetch(`/api/issues/${id}/cleanup`, { method: "POST" });
      if (res.ok) {
        await fetchIssue();
      }
    } catch { /* ignore */ } finally {
      setCleaningUp(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-[14px] font-mono text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          revealing quest details...
        </div>
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[14px] font-mono text-red">{error || "Quest not found on the map"}</div>
      </div>
    );
  }

  const isActive = !["completed", "failed", "pending"].includes(issue.status);
  const sessionIds = issue.phaseSessionIds || {};
  const latestSessionId = sessionIds[String(issue.currentPhase)] || Object.values(sessionIds).pop();
  const resumeCmd = latestSessionId
    ? `cd ${issue.worktreePath || issue.localRepoPath} && claude --resume ${latestSessionId}`
    : null;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="page-header">
        <div className="px-8 lg:px-16">
          <div className="animate-fade-in">
            <Link href="/issues" className="flex items-center gap-1.5 text-[13px] font-mono text-muted-foreground hover:text-accent mb-3 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              back to map
            </Link>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-accent text-[14px] glow-text">&gt;&gt;</span>
                  <h1 className="text-[22px] font-bold tracking-wide text-foreground glow-text">
                    {issue.title}
                  </h1>
                </div>
                <div className="flex items-center gap-3 ml-6 text-[13px] font-mono text-muted-foreground">
                  <span>{issue.repositoryName}</span>
                  <span className="text-border">|</span>
                  <span>{formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}</span>
                  {issue.branchName && (
                    <>
                      <span className="text-border">|</span>
                      <span className="text-accent">{issue.branchName}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {issue.prUrl && (
                  <a
                    href={issue.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 border border-green/50 bg-green/5 px-3 py-1.5 text-[13px] font-mono text-green hover:bg-green/10 transition-all"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    view PR
                  </a>
                )}
                {issue.status === "failed" && (
                  <button
                    onClick={handleRetry}
                    disabled={retrying}
                    className="flex items-center gap-1.5 border border-accent/50 bg-accent/5 px-3 py-1.5 text-[13px] font-mono text-accent hover:bg-accent/10 transition-all disabled:opacity-40"
                  >
                    {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    retry
                  </button>
                )}
                {isActive && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex items-center gap-1.5 border border-red/50 bg-red/5 px-3 py-1.5 text-[13px] font-mono text-red hover:bg-red/10 transition-all disabled:opacity-40"
                  >
                    {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 lg:px-16 py-8 space-y-6 max-w-5xl">
        {/* Status / Error */}
        {issue.error && (
          <div className="border border-red/30 bg-red/5 px-4 py-3 text-[14px] font-mono text-red">
            [ERROR] {issue.error}
          </div>
        )}

        {issue.status === "waiting_for_input" && (
          <div className="border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-[14px] font-mono text-amber-400">
            Awaiting your owl via Telegram...
          </div>
        )}

        {/* Pipeline progress */}
        <section className="term-card p-5">
          <div className="text-[12px] font-mono text-muted uppercase tracking-wider mb-4">
            spell progress
          </div>
          <PipelineBar currentPhase={issue.currentPhase} status={issue.status} />
        </section>

        {/* Description */}
        <CollapsibleSection title="Quest Description" content={issue.description} defaultOpen />

        {/* Phase outputs */}
        <CollapsibleSection title="The Plot" content={issue.planOutput} defaultOpen={issue.currentPhase <= 3} />
        <CollapsibleSection title="Adversarial Review" content={issue.planReview1} />
        <CollapsibleSection title="Completeness Review" content={issue.planReview2} />
        <CollapsibleSection title="Code Review (3 Specialists)" content={issue.codeReview1} />
        <CollapsibleSection title="Code Fixes" content={issue.codeReview2} />

        {/* Q&A Thread */}
        {issue.messages.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[13px] font-mono font-bold text-accent uppercase tracking-widest">
              &gt; Owl Correspondence
            </h2>
            <div className="space-y-2">
              {issue.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`term-card p-3 max-w-[80%] ${
                    msg.direction === "from_claude"
                      ? "border-l-2 border-l-accent mr-auto"
                      : "border-r-2 border-r-blue-400 ml-auto"
                  }`}
                >
                  <div className="text-[11px] font-mono text-muted uppercase mb-1">
                    {msg.direction === "from_claude" ? "Claude" : "You"}{" "}
                    <span className="text-muted/50">{formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}</span>
                  </div>
                  <div className="text-[14px] font-mono text-muted-foreground whitespace-pre-wrap">
                    {msg.message}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Resume / Session Info */}
        {resumeCmd && (
          <section className="space-y-3">
            <h2 className="text-[13px] font-mono font-bold text-accent uppercase tracking-widest">
              &gt; Resume in CLI
            </h2>
            <div className="term-card p-3">
              <div className="flex items-center justify-between gap-2">
                <code className="text-[13px] font-mono text-muted-foreground break-all">
                  {resumeCmd}
                </code>
                <CopyButton text={resumeCmd} />
              </div>
            </div>
          </section>
        )}

        {/* Worktree info */}
        {issue.worktreePath && (
          <section className="space-y-2">
            <h2 className="text-[13px] font-mono font-bold text-accent uppercase tracking-widest">
              &gt; Worktree
            </h2>
            <div className="term-card p-3">
              <div className="flex items-center justify-between gap-2">
                <code className="text-[13px] font-mono text-muted-foreground">
                  {issue.worktreePath}
                </code>
                <div className="flex items-center gap-2">
                  <CopyButton text={issue.worktreePath} />
                  {(issue.status === "completed" || issue.status === "failed") && (
                    <button
                      onClick={handleCleanup}
                      disabled={cleaningUp}
                      className="text-[11px] font-mono text-muted-foreground hover:text-red transition-colors whitespace-nowrap"
                    >
                      {cleaningUp ? "cleaning..." : "remove"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Session IDs */}
        {Object.keys(sessionIds).length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[13px] font-mono font-bold text-accent uppercase tracking-widest">
              &gt; Session IDs
            </h2>
            <div className="term-card p-3 space-y-1">
              {Object.entries(sessionIds).map(([phase, sid]) => (
                <div key={phase} className="flex items-center justify-between text-[12px] font-mono">
                  <span className="text-muted">Phase {phase}:</span>
                  <div className="flex items-center gap-2">
                    <code className="text-muted-foreground">{sid.substring(0, 12)}...</code>
                    <CopyButton text={sid} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
