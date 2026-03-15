"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Bot,
  Clock,
  Globe,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Zap,
  FileText,
  Send,
  Loader2,
  Trash2,
  Pencil,
  X,
  Key,
  Wrench,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { AgentForm } from "@/components/agents/agent-form";
import type { AgentFormData } from "@/components/agents/agent-form";
import { cronToHuman } from "@/lib/utils/cron";

interface AgentDetail {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  soul: string;
  skill: string;
  schedule: string;
  timezone: string | null;
  envVars: Record<string, string>;
}

interface AgentRun {
  id: string;
  status: string;
  output: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  toolUseCount: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string | null;
}

interface ToolUse {
  id: number;
  toolName: string;
  toolInput: string | null;
  toolOutput: string | null;
  isError: boolean;
  durationMs: number | null;
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
    <div className="border border-border bg-surface overflow-hidden term-card">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-5 py-3 text-[12px] font-mono font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="text-accent">{open ? "[-]" : "[+]"}</span>
        <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        {title}
        <div className="flex-1" />
      </button>
      {open && (
        <div className="border-t border-border/40 px-5 py-4">
          {children}
        </div>
      )}
    </div>
  );
}

function RunItem({ run, index, agentId }: { run: AgentRun; index: number; agentId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [toolUses, setToolUses] = useState<ToolUse[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
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
  const tokens = (run.promptTokens || 0) + (run.completionTokens || 0);

  return (
    <div
      className="animate-slide-up border-b border-border/30 last:border-0"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
      >
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

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-foreground font-medium">{time}</span>
            {timeAgo && <span className="text-muted">{timeAgo}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
            {duration && <span className="font-mono">{duration}</span>}
            {tokens > 0 && (
              <span className="flex items-center gap-1 font-mono">
                <Zap className="h-2.5 w-2.5" />
                {tokens.toLocaleString()}
              </span>
            )}
            {(run.toolUseCount ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Wrench className="h-2.5 w-2.5" />
                {run.toolUseCount} tools
              </span>
            )}
          </div>
          {!expanded && run.output && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
              {run.output}
            </p>
          )}
        </div>

        {(run.output || run.error) &&
          (expanded ? (
            <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" />
          ))}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pl-12 space-y-3">
          {run.error && (
            <div className="rounded-lg border border-red/20 bg-red/5 px-3 py-2">
              <p className="text-[13px] font-medium text-red">Error</p>
              <p className="mt-1 font-mono text-[13px] leading-relaxed text-red/80">
                {run.error}
              </p>
            </div>
          )}

          {/* Tool Uses */}
          {(run.toolUseCount ?? 0) > 0 && (
            <div className="rounded-lg border border-border/50 bg-background/60 overflow-hidden">
              <button
                onClick={async () => {
                  if (toolUses) { setToolUses(null); return; }
                  setLoadingTools(true);
                  try {
                    const res = await fetch(`/api/agents/${agentId}/runs/${run.id}/tools`);
                    if (res.ok) {
                      const data = await res.json();
                      setToolUses(data.tools);
                    }
                  } finally {
                    setLoadingTools(false);
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Wrench className="h-3 w-3" />
                Tool Log ({run.toolUseCount})
                {loadingTools && <Loader2 className="h-3 w-3 animate-spin" />}
                <div className="flex-1" />
                {toolUses ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {toolUses && (
                <div className="border-t border-border/30">
                  {toolUses.map((tu, i) => (
                    <div key={tu.id} className={cn("px-3 py-2 text-[12px]", i > 0 && "border-t border-border/20")}>
                      <div className="flex items-center gap-2">
                        <span className={cn("font-mono font-medium", tu.isError ? "text-red" : "text-accent")}>
                          {tu.toolName}
                        </span>
                        {tu.durationMs != null && (
                          <span className="font-mono text-muted">{tu.durationMs}ms</span>
                        )}
                        {tu.isError && (
                          <span className="rounded bg-red/10 px-1 py-0.5 text-[8px] font-bold text-red">ERROR</span>
                        )}
                      </div>
                      {tu.toolInput && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-muted hover:text-muted-foreground">Input</summary>
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground bg-surface-raised rounded p-1.5 max-h-[200px] overflow-auto">
                            {tu.toolInput}
                          </pre>
                        </details>
                      )}
                      {tu.toolOutput && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-muted hover:text-muted-foreground">Output</summary>
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground bg-surface-raised rounded p-1.5 max-h-[200px] overflow-auto">
                            {tu.toolOutput}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {run.output && (
            <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-2">
              <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-muted-foreground">
                {run.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TelegramConfigData {
  configured: boolean;
  enabled: boolean;
  botToken: string;
  chatId: string;
  botName: string;
}

type SetupPhase = "idle" | "validating" | "polling" | "manual" | "found" | "saving";

const inputClasses =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted outline-none transition-colors focus:border-accent/50 font-mono";

function TelegramSection({ agentId }: { agentId: string }) {
  const [config, setConfig] = useState<TelegramConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<SetupPhase>("idle");
  const [botToken, setBotToken] = useState("");
  const [botInfo, setBotInfo] = useState<{ botName: string; botUsername: string } | null>(null);
  const [chatId, setChatId] = useState("");
  const [chatTitle, setChatTitle] = useState("");
  const [manualChatId, setManualChatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/telegram`)
      .then((r) => r.json())
      .then((data: TelegramConfigData) => setConfig(data))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    if (phase !== "polling" || !botToken) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;

    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) {
        if (!cancelled && attempts >= maxAttempts) setPhase("manual");
        return;
      }
      attempts++;
      try {
        const res = await fetch(`/api/agents/${agentId}/telegram/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botToken, action: "poll" }),
        });
        const data = await res.json();
        if (data.found && !cancelled) {
          setChatId(data.chatId);
          setChatTitle(data.chatTitle || "");
          setPhase("found");
          return;
        }
      } catch { /* retry */ }
      if (!cancelled) setTimeout(poll, 3000);
    };
    poll();
    return () => { cancelled = true; };
  }, [phase, botToken, agentId]);

  const handleValidate = async () => {
    setError(null);
    setPhase("validating");
    try {
      const res = await fetch(`/api/agents/${agentId}/telegram/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, action: "validate" }),
      });
      const data = await res.json();
      if (!data.valid) {
        setError(data.error || "Invalid bot token");
        setPhase("idle");
        return;
      }
      setBotInfo({ botName: data.botName, botUsername: data.botUsername });
      setPhase("polling");
    } catch {
      setError("Failed to validate token");
      setPhase("idle");
    }
  };

  const handleSave = async (overrideChatId?: string) => {
    const finalChatId = overrideChatId || chatId;
    if (!finalChatId) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, chatId: finalChatId, botName: botInfo?.botName || "" }),
      });
      if (!res.ok) { setError("Failed to save config"); setPhase("found"); return; }

      const testRes = await fetch(`/api/agents/${agentId}/telegram/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, chatId: finalChatId }),
      });
      const testData = await testRes.json();

      const cfgRes = await fetch(`/api/agents/${agentId}/telegram`);
      const cfgData = await cfgRes.json();
      setConfig(cfgData);
      setPhase("idle");
      setBotToken("");
      setChatId("");
      setBotInfo(null);
      setTestResult(testData.success ? { success: true } : { success: false, error: testData.error || "Test failed" });
    } catch {
      setError("Failed to save config");
      setPhase("found");
    }
  };

  const handleTest = async () => {
    if (!config?.configured) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/telegram/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useStored: true }),
      });
      setTestResult(await res.json());
    } catch {
      setTestResult({ success: false, error: "Test request failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleRemove = async () => {
    try {
      await fetch(`/api/agents/${agentId}/telegram`, { method: "DELETE" });
      setConfig({ configured: false, enabled: false, botToken: "", chatId: "", botName: "" });
      setTestResult(null);
    } catch {
      setError("Failed to remove config");
    }
  };

  if (loading) return <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted" /></div>;

  if (config?.configured && phase === "idle") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-green/20 bg-green/5 px-3 py-2">
          <Check className="h-3.5 w-3.5 text-green" />
          <span className="text-[13px] text-green">Connected{config.botName ? ` to ${config.botName}` : ""}</span>
        </div>
        <div className="space-y-2 text-[13px]">
          <div className="flex items-center justify-between"><span className="text-muted">Bot Token</span><span className="font-mono text-muted-foreground">{config.botToken}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted">Chat ID</span><span className="font-mono text-muted-foreground">{config.chatId}</span></div>
        </div>
        {testResult && (
          <div className={cn("rounded-lg border px-3 py-2 text-[13px]", testResult.success ? "border-green/20 bg-green/5 text-green" : "border-red/20 bg-red/5 text-red")}>
            {testResult.success ? "Test message sent successfully" : `Test failed: ${testResult.error}`}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={handleTest} disabled={testing} className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50">
            {testing ? "Testing..." : "Test"}
          </button>
          <button onClick={handleRemove} className="rounded-lg border border-red/20 px-3 py-1.5 text-[13px] font-medium text-red/70 transition-colors hover:bg-red/5 hover:text-red">
            <Trash2 className="inline h-3 w-3 mr-1" />Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(phase === "idle" || phase === "validating") && (
        <div className="space-y-2">
          <label className="block text-[13px] text-muted">Bot Token</label>
          <input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABC-DEFGhijklmnop..." className={inputClasses} disabled={phase === "validating"} />
          <p className="text-[12px] text-muted">Create a bot via <span className="font-medium text-muted-foreground">@BotFather</span> on Telegram, then paste the token here.</p>
          <button onClick={handleValidate} disabled={!botToken.trim() || phase === "validating"} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50">
            {phase === "validating" ? <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Validating...</span> : "Connect"}
          </button>
        </div>
      )}
      {phase === "polling" && botInfo && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2"><Check className="h-3.5 w-3.5 text-accent" /><span className="text-[13px] text-accent">Connected to @{botInfo.botUsername || botInfo.botName}</span></div>
          <div className="rounded-lg border border-border bg-surface-raised px-3 py-3 space-y-2">
            <div className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /><span className="text-[13px] font-medium text-foreground">Waiting for your message...</span></div>
            <p className="text-[12px] text-muted leading-relaxed">Open Telegram and send <code className="rounded bg-background px-1 py-0.5 text-accent">/start</code> to <span className="font-medium text-muted-foreground">@{botInfo.botUsername || botInfo.botName}</span></p>
          </div>
          <button onClick={() => { setPhase("idle"); setBotInfo(null); }} className="text-[12px] text-muted hover:text-muted-foreground transition-colors"><X className="inline h-3 w-3 mr-0.5" />Cancel</button>
        </div>
      )}
      {phase === "manual" && botInfo && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2"><Check className="h-3.5 w-3.5 text-accent" /><span className="text-[13px] text-accent">Connected to @{botInfo.botUsername || botInfo.botName}</span></div>
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2"><p className="text-[12px] text-yellow-600 dark:text-yellow-400">Could not auto-detect chat ID. Enter it manually below.</p></div>
          <div className="space-y-2"><label className="block text-[13px] text-muted">Chat ID</label><input type="text" value={manualChatId} onChange={(e) => setManualChatId(e.target.value)} placeholder="-100123456789" className={inputClasses} /></div>
          <div className="flex gap-2">
            <button onClick={() => handleSave(manualChatId)} disabled={!manualChatId.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50">Save</button>
            <button onClick={() => { setPhase("idle"); setBotInfo(null); setManualChatId(""); }} className="text-[12px] text-muted hover:text-muted-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}
      {(phase === "found" || phase === "saving") && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-green/20 bg-green/5 px-3 py-2"><Check className="h-3.5 w-3.5 text-green" /><span className="text-[13px] text-green">Chat found{chatTitle ? `: ${chatTitle}` : ""}</span></div>
          <div className="space-y-1 text-[13px]">
            <div className="flex items-center justify-between"><span className="text-muted">Bot</span><span className="font-mono text-muted-foreground">@{botInfo?.botUsername || botInfo?.botName}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted">Chat ID</span><span className="font-mono text-muted-foreground">{chatId}</span></div>
          </div>
          <button onClick={() => handleSave()} disabled={phase === "saving"} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50">
            {phase === "saving" ? <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Saving...</span> : "Save & Test"}
          </button>
        </div>
      )}
      {error && <div className="rounded-lg border border-red/20 bg-red/5 px-3 py-2 text-[13px] text-red">{error}</div>}
    </div>
  );
}

export default function AgentDetailPage() {
  const params = useParams<{ id: string; agentId: string }>();
  const router = useRouter();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [agentRes, runsRes] = await Promise.all([
        fetch(`/api/agents/${params.agentId}`),
        fetch(`/api/agents/${params.agentId}/runs?limit=20`),
      ]);
      if (!agentRes.ok) { setError("Agent not found"); return; }
      setAgent(await agentRes.json());
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        setRuns(runsData.runs);
        setTotalRuns(runsData.total);
      }
    } catch {
      setError("Failed to load agent");
    } finally {
      setLoading(false);
    }
  }, [params.agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/agents/${params.agentId}/runs?limit=20&offset=${runs.length}`);
      if (res.ok) {
        const data = await res.json();
        setRuns((prev) => [...prev, ...data.runs]);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [params.agentId, runs.length]);

  const handleEdit = async (data: AgentFormData) => {
    const res = await fetch(`/api/agents/${params.agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        soul: data.soul,
        skill: data.skill,
        schedule: data.schedule,
        timezone: data.timezone || undefined,
        envVars: data.envVars,
        enabled: data.enabled,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update agent");
    }
    setAgent(await res.json());
    setEditMode(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${params.agentId}`, { method: "DELETE" });
      if (res.ok) router.push(`/projects/${params.id}`);
      else setError("Failed to delete agent");
    } catch {
      setError("Failed to delete agent");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-1.5">
          <span className="loading-dot h-2 w-2 rounded-full bg-accent/60" />
          <span className="loading-dot h-2 w-2 rounded-full bg-accent/60" />
          <span className="loading-dot h-2 w-2 rounded-full bg-accent/60" />
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface border border-border">
          <AlertCircle className="h-6 w-6 text-muted" />
        </div>
        <p className="text-[16px] text-muted-foreground">{error || "Agent not found"}</p>
        <Link href={`/projects/${params.id}`} className="inline-flex items-center gap-1.5 text-[14px] text-accent transition-colors hover:text-accent-dim">
          <ArrowLeft className="h-3 w-3" />Back to Project
        </Link>
      </div>
    );
  }

  if (editMode) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="page-header grid-pattern">
          <div className="px-8 lg:px-12">
            <div className="animate-fade-in">
              <button
                onClick={() => setEditMode(false)}
                className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground group mb-5"
              >
                <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                Cancel editing
              </button>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 border border-accent/20">
                  <Bot className="h-5.5 w-5.5 text-accent" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">Edit Agent</h1>
                  <p className="text-[15px] text-muted-foreground">{agent.name}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="px-8 lg:px-12 py-8">
          <div className="rounded-2xl border border-border bg-surface p-8 max-w-4xl">
            <AgentForm
              initialValues={{
                name: agent.name,
                soul: agent.soul,
                skill: agent.skill,
                schedule: agent.schedule,
                timezone: agent.timezone || "",
                envVars: agent.envVars || {},
                enabled: agent.enabled,
              }}
              onSubmit={handleEdit}
              submitLabel="Save Changes"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Hero header */}
      <div className="page-header grid-pattern">
        <div className="px-8 lg:px-12">
          <div className="animate-fade-in">
            <Link
              href={`/projects/${params.id}`}
              className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground group mb-5"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              Back to Project
            </Link>

            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 border border-accent/20">
                    <Bot className="h-5.5 w-5.5 text-accent" />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">{agent.name}</h1>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.1em]",
                    agent.enabled ? "border-green/20 bg-green/8 text-green" : "border-border bg-surface-raised text-muted"
                  )}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", agent.enabled ? "bg-green status-dot-live" : "bg-muted")} />
                    {agent.enabled ? "Active" : "Paused"}
                  </span>
                  <button onClick={() => setEditMode(true)} className="rounded-xl border border-border p-2.5 text-muted-foreground transition-colors hover:text-foreground hover:border-border-hover" title="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <button onClick={handleDelete} disabled={deleting} className="rounded-xl bg-red/10 border border-red/20 px-3 py-1.5 text-[13px] font-medium text-red hover:bg-red/20 disabled:opacity-50">{deleting ? "..." : "Delete"}</button>
                      <button onClick={() => setConfirmDelete(false)} className="text-[13px] text-muted hover:text-foreground">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} className="rounded-xl border border-red/20 p-2.5 text-red/50 transition-colors hover:text-red hover:bg-red/5" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Meta tags */}
              <div className="flex flex-wrap items-center gap-2 ml-[56px] text-[13px]">
                <span className="flex items-center gap-1.5 rounded-lg bg-surface-raised px-2.5 py-1 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-muted" />{cronToHuman(agent.schedule)}
                </span>
                {agent.timezone && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-surface-raised px-2.5 py-1 text-muted-foreground">
                    <Globe className="h-3.5 w-3.5 text-muted" />{agent.timezone}
                  </span>
                )}
                {Object.keys(agent.envVars || {}).length > 0 && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-surface-raised px-2.5 py-1 text-muted-foreground">
                    <Key className="h-3.5 w-3.5 text-muted" />{Object.keys(agent.envVars).length} env vars
                  </span>
                )}
                <span className="rounded-lg bg-accent/8 border border-accent/15 px-2.5 py-1 text-[12px] font-medium text-accent">Claude CLI</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 lg:px-12 py-8 space-y-6 max-w-6xl">
        {/* Two-column layout for Soul/Skill + Telegram */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CollapsibleSection title="Personality (Soul)" icon={Bot} iconColor="text-accent">
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-muted-foreground">{agent.soul}</pre>
          </CollapsibleSection>

          <CollapsibleSection title="Task (Skill)" icon={FileText} iconColor="text-accent">
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-muted-foreground">{agent.skill}</pre>
          </CollapsibleSection>
        </div>

        {/* Telegram */}
        <CollapsibleSection title="Telegram Notifications" icon={Send} iconColor="text-accent" defaultOpen>
          <TelegramSection agentId={agent.id} />
        </CollapsibleSection>

        {/* Run History */}
        <div className="animate-fade-in rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-[14px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Run History</span>
            <span className="rounded-full bg-accent/10 border border-accent/15 px-2.5 py-0.5 font-mono text-[13px] font-medium text-accent">{totalRuns}</span>
          </div>

          {runs.length === 0 ? (
            <div className="border-t border-border/40 px-5 py-10 text-center">
              <p className="text-[15px] text-muted">No runs recorded yet</p>
            </div>
          ) : (
            <div className="border-t border-border/40">
              {runs.map((run, idx) => (
                <RunItem key={run.id} run={run} index={idx} agentId={params.agentId} />
              ))}
            </div>
          )}

          {runs.length < totalRuns && (
            <div className="border-t border-border/40 px-5 py-3.5">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full rounded-xl border border-border px-4 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50"
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
