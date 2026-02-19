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
  Send,
  Loader2,
  Trash2,
  X,
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

interface TelegramConfigData {
  configured: boolean;
  enabled: boolean;
  botToken: string;
  chatId: string;
  botName: string;
}

type SetupPhase = "idle" | "validating" | "polling" | "manual" | "found" | "saving";

const inputClasses =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground placeholder:text-muted outline-none transition-colors focus:border-accent/50 font-mono";

function TelegramSection({ agentName }: { agentName: string }) {
  const [config, setConfig] = useState<TelegramConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<SetupPhase>("idle");
  const [botToken, setBotToken] = useState("");
  const [botInfo, setBotInfo] = useState<{
    botName: string;
    botUsername: string;
  } | null>(null);
  const [chatId, setChatId] = useState("");
  const [chatTitle, setChatTitle] = useState("");
  const [manualChatId, setManualChatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  // Fetch existing config
  useEffect(() => {
    fetch(`/api/cron-agents/${agentName}/telegram`)
      .then((r) => r.json())
      .then((data: TelegramConfigData) => setConfig(data))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [agentName]);

  // Poll for chat ID when in polling phase
  useEffect(() => {
    if (phase !== "polling" || !botToken) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20; // 60s at 3s interval

    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) {
        if (!cancelled && attempts >= maxAttempts) {
          setPhase("manual");
        }
        return;
      }
      attempts++;

      try {
        const res = await fetch(
          `/api/cron-agents/${agentName}/telegram/setup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ botToken, action: "poll" }),
          }
        );
        const data = await res.json();
        if (data.found && !cancelled) {
          setChatId(data.chatId);
          setChatTitle(data.chatTitle || "");
          setPhase("found");
          return;
        }
      } catch {
        // ignore, will retry
      }

      if (!cancelled) {
        setTimeout(poll, 3000);
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [phase, botToken, agentName]);

  const handleValidate = async () => {
    setError(null);
    setPhase("validating");

    try {
      const res = await fetch(
        `/api/cron-agents/${agentName}/telegram/setup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botToken, action: "validate" }),
        }
      );
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
      const res = await fetch(`/api/cron-agents/${agentName}/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken,
          chatId: finalChatId,
          botName: botInfo?.botName || "",
        }),
      });

      if (!res.ok) {
        setError("Failed to save config");
        setPhase("found");
        return;
      }

      // Also send a test message
      const testRes = await fetch(
        `/api/cron-agents/${agentName}/telegram/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botToken, chatId: finalChatId }),
        }
      );
      const testData = await testRes.json();

      // Refresh config
      const cfgRes = await fetch(`/api/cron-agents/${agentName}/telegram`);
      const cfgData = await cfgRes.json();
      setConfig(cfgData);
      setPhase("idle");
      setBotToken("");
      setChatId("");
      setBotInfo(null);

      if (testData.success) {
        setTestResult({ success: true });
      } else {
        setTestResult({
          success: false,
          error: testData.error || "Test failed",
        });
      }
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
      const res = await fetch(
        `/api/cron-agents/${agentName}/telegram/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ useStored: true }),
        }
      );
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, error: "Test request failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleRemove = async () => {
    try {
      await fetch(`/api/cron-agents/${agentName}/telegram`, {
        method: "DELETE",
      });
      setConfig({
        configured: false,
        enabled: false,
        botToken: "",
        chatId: "",
        botName: "",
      });
      setTestResult(null);
    } catch {
      setError("Failed to remove config");
    }
  };

  if (loading) {
    return (
      <div className="py-4 text-center">
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted" />
      </div>
    );
  }

  // Configured state
  if (config?.configured && phase === "idle") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-green/20 bg-green/5 px-3 py-2">
          <Check className="h-3.5 w-3.5 text-green" />
          <span className="text-[11px] text-green">
            Connected{config.botName ? ` to ${config.botName}` : ""}
          </span>
        </div>

        <div className="space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-muted">Bot Token</span>
            <span className="font-mono text-muted-foreground">
              {config.botToken}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Chat ID</span>
            <span className="font-mono text-muted-foreground">
              {config.chatId}
            </span>
          </div>
        </div>

        {testResult && (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-[11px]",
              testResult.success
                ? "border-green/20 bg-green/5 text-green"
                : "border-red/20 bg-red/5 text-red"
            )}
          >
            {testResult.success
              ? "Test message sent successfully"
              : `Test failed: ${testResult.error}`}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test"}
          </button>
          <button
            onClick={handleRemove}
            className="rounded-lg border border-red/20 px-3 py-1.5 text-[11px] font-medium text-red/70 transition-colors hover:bg-red/5 hover:text-red"
          >
            <Trash2 className="inline h-3 w-3 mr-1" />
            Remove
          </button>
        </div>
      </div>
    );
  }

  // Setup flow
  return (
    <div className="space-y-3">
      {/* Phase: idle — enter bot token */}
      {(phase === "idle" || phase === "validating") && (
        <div className="space-y-2">
          <label className="block text-[11px] text-muted">
            Bot Token
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456:ABC-DEFGhijklmnop..."
            className={inputClasses}
            disabled={phase === "validating"}
          />
          <p className="text-[10px] text-muted">
            Create a bot via{" "}
            <span className="font-medium text-muted-foreground">
              @BotFather
            </span>{" "}
            on Telegram, then paste the token here.
          </p>
          <button
            onClick={handleValidate}
            disabled={!botToken.trim() || phase === "validating"}
            className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
          >
            {phase === "validating" ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Validating...
              </span>
            ) : (
              "Connect"
            )}
          </button>
        </div>
      )}

      {/* Phase: polling — waiting for /start */}
      {phase === "polling" && botInfo && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
            <Check className="h-3.5 w-3.5 text-accent" />
            <span className="text-[11px] text-accent">
              Connected to @{botInfo.botUsername || botInfo.botName}
            </span>
          </div>

          <div className="rounded-lg border border-border bg-surface-raised px-3 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              <span className="text-[11px] font-medium text-foreground">
                Waiting for your message...
              </span>
            </div>
            <p className="text-[10px] text-muted leading-relaxed">
              Open Telegram and send{" "}
              <code className="rounded bg-background px-1 py-0.5 text-accent">
                /start
              </code>{" "}
              to{" "}
              <span className="font-medium text-muted-foreground">
                @{botInfo.botUsername || botInfo.botName}
              </span>
            </p>
          </div>

          <button
            onClick={() => {
              setPhase("idle");
              setBotInfo(null);
            }}
            className="text-[10px] text-muted hover:text-muted-foreground transition-colors"
          >
            <X className="inline h-3 w-3 mr-0.5" />
            Cancel
          </button>
        </div>
      )}

      {/* Phase: manual — timeout, enter chat ID manually */}
      {phase === "manual" && botInfo && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
            <Check className="h-3.5 w-3.5 text-accent" />
            <span className="text-[11px] text-accent">
              Connected to @{botInfo.botUsername || botInfo.botName}
            </span>
          </div>

          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
            <p className="text-[10px] text-yellow-600 dark:text-yellow-400">
              Could not auto-detect chat ID. Enter it manually below.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] text-muted">Chat ID</label>
            <input
              type="text"
              value={manualChatId}
              onChange={(e) => setManualChatId(e.target.value)}
              placeholder="-100123456789"
              className={inputClasses}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleSave(manualChatId)}
              disabled={!manualChatId.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => {
                setPhase("idle");
                setBotInfo(null);
                setManualChatId("");
              }}
              className="text-[10px] text-muted hover:text-muted-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Phase: found — chat ID auto-detected */}
      {(phase === "found" || phase === "saving") && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-green/20 bg-green/5 px-3 py-2">
            <Check className="h-3.5 w-3.5 text-green" />
            <span className="text-[11px] text-green">
              Chat found{chatTitle ? `: ${chatTitle}` : ""}
            </span>
          </div>

          <div className="space-y-1 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-muted">Bot</span>
              <span className="font-mono text-muted-foreground">
                @{botInfo?.botUsername || botInfo?.botName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Chat ID</span>
              <span className="font-mono text-muted-foreground">{chatId}</span>
            </div>
          </div>

          <button
            onClick={() => handleSave()}
            disabled={phase === "saving"}
            className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
          >
            {phase === "saving" ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </span>
            ) : (
              "Save & Test"
            )}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red/20 bg-red/5 px-3 py-2 text-[11px] text-red">
          {error}
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

        {/* Telegram */}
        <CollapsibleSection
          title="Telegram Notifications"
          icon={Send}
          iconColor="text-accent"
          defaultOpen
        >
          <TelegramSection agentName={agent.name} />
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
