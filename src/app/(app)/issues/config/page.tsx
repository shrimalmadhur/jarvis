"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Trash2,
  Pencil,
  X,
  Check,
  Send,
  FolderOpen,
} from "lucide-react";
import { DirectoryPicker } from "@/components/ui/directory-picker";

interface Repository {
  id: string;
  name: string;
  githubRepoUrl: string | null;
  localRepoPath: string;
  defaultBranch: string;
  issueCount: number;
  createdAt: string;
}

interface TelegramConfig {
  configured: boolean;
  enabled: boolean;
  botToken: string | null;
  chatId: string | null;
}

interface SlackConfig {
  configured: boolean;
  enabled: boolean;
  botToken: string | null;
  appToken: string | null;
  channelId: string | null;
  diagnostics?: {
    socketConnected: boolean;
    appMentionReceived: boolean;
    messageReceived: boolean;
    threadRepliesMayNotWork: boolean;
    uptimeMs: number;
  };
}

export default function IssuesConfigPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [telegram, setTelegram] = useState<TelegramConfig | null>(null);
  const [slack, setSlack] = useState<SlackConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPath, setCreatePath] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [createBranch, setCreateBranch] = useState("main");
  const [creating, setCreating] = useState(false);

  // Browse state
  const [showBrowseCreate, setShowBrowseCreate] = useState(false);
  const [showBrowseEdit, setShowBrowseEdit] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editBranch, setEditBranch] = useState("");

  // Telegram setup flow
  type TgPhase = "idle" | "validating" | "polling" | "manual" | "found" | "saving";
  const [tgPhase, setTgPhase] = useState<TgPhase>("idle");
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgBotInfo, setTgBotInfo] = useState<{ botName: string; botUsername: string } | null>(null);
  const [tgChatId, setTgChatId] = useState("");
  const [tgChatTitle, setTgChatTitle] = useState("");
  const [tgManualChatId, setTgManualChatId] = useState("");

  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");
  const [savingSlack, setSavingSlack] = useState(false);

  async function fetchAll() {
    try {
      const [repoRes, tgRes, slackRes] = await Promise.all([
        fetch("/api/issues/projects"),
        fetch("/api/issues/telegram"),
        fetch("/api/issues/slack"),
      ]);
      if (repoRes.ok) {
        const data = await repoRes.json();
        setRepos(data.repositories);
      }
      if (tgRes.ok) {
        const data = await tgRes.json();
        setTelegram(data);
      }
      if (slackRes.ok) {
        const data = await slackRes.json();
        setSlack(data);
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  function showError(msg: string) {
    setError(msg);
    setSuccess(null);
    setTimeout(() => setError(null), 5000);
  }

  function showSuccess(msg: string) {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 3000);
  }

  async function handleCreateRepo(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim() || !createPath.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/issues/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          localRepoPath: createPath.trim(),
          githubRepoUrl: createUrl.trim() || undefined,
          defaultBranch: createBranch.trim() || "main",
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        showError(data.error || "Failed to create repository");
        return;
      }
      setCreateName("");
      setCreatePath("");
      setCreateUrl("");
      setCreateBranch("main");
      setShowCreate(false);
      showSuccess("Repository created");
      await fetchAll();
    } catch {
      showError("Failed to create repository");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteRepo(id: string) {
    try {
      const res = await fetch(`/api/issues/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        showError(data.error || "Failed to delete");
        return;
      }
      showSuccess("Repository deleted");
      await fetchAll();
    } catch {
      showError("Failed to delete repository");
    }
  }

  async function handleSaveEdit() {
    if (!editId) return;
    try {
      const res = await fetch(`/api/issues/projects/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          localRepoPath: editPath.trim(),
          githubRepoUrl: editUrl.trim() || undefined,
          defaultBranch: editBranch.trim() || "main",
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        showError(data.error || "Failed to update");
        return;
      }
      setEditId(null);
      showSuccess("Repository updated");
      await fetchAll();
    } catch {
      showError("Failed to update repository");
    }
  }

  function startEdit(repo: Repository) {
    setEditId(repo.id);
    setEditName(repo.name);
    setEditPath(repo.localRepoPath);
    setEditUrl(repo.githubRepoUrl || "");
    setEditBranch(repo.defaultBranch);
    setShowBrowseEdit(false);
  }

  // Poll for chat ID after validation
  useEffect(() => {
    if (tgPhase !== "polling" || !tgBotToken) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;

    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) {
        if (!cancelled && attempts >= maxAttempts) setTgPhase("manual");
        return;
      }
      attempts++;
      try {
        const res = await fetch("/api/issues/telegram/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botToken: tgBotToken, action: "poll" }),
        });
        const data = await res.json();
        if (data.found && !cancelled) {
          setTgChatId(data.chatId);
          setTgChatTitle(data.chatTitle || "");
          setTgPhase("found");
          return;
        }
      } catch { /* retry */ }
      if (!cancelled) setTimeout(poll, 3000);
    };
    poll();
    return () => { cancelled = true; };
  }, [tgPhase, tgBotToken]);

  async function handleTgValidate() {
    setError(null);
    setTgPhase("validating");
    try {
      const res = await fetch("/api/issues/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: tgBotToken, action: "validate" }),
      });
      const data = await res.json();
      if (!data.valid) {
        showError(data.error || "Invalid bot token");
        setTgPhase("idle");
        return;
      }
      setTgBotInfo({ botName: data.botName, botUsername: data.botUsername });
      setTgPhase("polling");
    } catch {
      showError("Failed to validate token");
      setTgPhase("idle");
    }
  }

  async function handleTgSave(overrideChatId?: string) {
    const finalChatId = overrideChatId || tgChatId;
    if (!finalChatId) return;
    const returnPhase: TgPhase = overrideChatId ? "manual" : "found";
    setTgPhase("saving");
    setError(null);
    try {
      const res = await fetch("/api/issues/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: tgBotToken, chatId: finalChatId, test: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        showError(data.error || "Failed to save config");
        setTgPhase(returnPhase);
        return;
      }
      setTgBotToken("");
      setTgChatId("");
      setTgBotInfo(null);
      setTgPhase("idle");
      showSuccess("Telegram bot configured and tested");
      await fetchAll();
    } catch {
      showError("Failed to save config");
      setTgPhase(returnPhase);
    }
  }

  async function handleDeleteTelegram() {
    try {
      const res = await fetch("/api/issues/telegram", { method: "DELETE" });
      if (!res.ok) {
        showError("Failed to remove Telegram config");
        return;
      }
      showSuccess("Telegram config removed");
      await fetchAll();
    } catch {
      showError("Failed to remove Telegram config");
    }
  }

  async function handleSaveSlack() {
    setSavingSlack(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/issues/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken: slackBotToken.trim(),
          appToken: slackAppToken.trim(),
          channelId: slackChannelId.trim() || undefined,
          test: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        showError(data.error || "Failed to save Slack config");
        return;
      }

      const data = await res.json();
      setSlackBotToken("");
      setSlackAppToken("");
      setSlackChannelId("");

      if (data.warnings?.length) {
        setWarning(data.warnings.join(" "));
      }
      showSuccess("Slack app configured and tested");
      await fetchAll();
    } catch {
      showError("Failed to save Slack config");
    } finally {
      setSavingSlack(false);
    }
  }

  async function handleDeleteSlack() {
    try {
      const res = await fetch("/api/issues/slack", { method: "DELETE" });
      if (!res.ok) {
        showError("Failed to remove Slack config");
        return;
      }
      showSuccess("Slack config removed");
      await fetchAll();
    } catch {
      showError("Failed to remove Slack config");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-[14px] font-mono text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          loading config...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="page-header">
        <div className="px-8 lg:px-16">
          <div className="animate-fade-in">
            <Link href="/issues" className="flex items-center gap-1.5 text-[13px] font-mono text-muted-foreground hover:text-accent mb-3 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              back to issues
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-accent text-[14px] glow-text">&gt;&gt;</span>
              <h1 className="text-[24px] font-bold tracking-widest text-foreground uppercase glow-text">
                Issues Config
              </h1>
            </div>
            <p className="text-[14px] text-muted-foreground font-mono ml-6 mt-1">
              // configure issue tracking settings
            </p>
          </div>
        </div>
      </div>

      <div className="px-8 lg:px-16 py-8 space-y-8 max-w-4xl">
        {/* Status messages */}
        {error && (
          <div className="animate-type-in border border-red/30 bg-red/5 px-4 py-2.5 text-[14px] font-mono text-red">
            [ERROR] {error}
          </div>
        )}
        {success && (
          <div className="animate-type-in border border-green/30 bg-green/5 px-4 py-2.5 text-[14px] font-mono text-green">
            [OK] {success}
          </div>
        )}
        {warning && (
          <div className="animate-type-in border border-amber-400/30 bg-amber-400/5 px-4 py-2.5 text-[14px] font-mono text-amber-400">
            [WARN] {warning}
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-[14px] font-mono font-bold text-accent uppercase tracking-widest">
            &gt; Slack Issue App
          </h2>
          <p className="text-[13px] font-mono text-muted-foreground ml-4">
            Uses Slack Socket Mode so issue creation and all follow-up replies stay inside the Slack thread.
          </p>

          {slack?.configured ? (
            <div className="term-card p-4 space-y-2">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <div className="text-[12px] font-mono text-muted uppercase">bot token</div>
                  <div className="text-[14px] font-mono text-foreground">{slack.botToken}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[12px] font-mono text-muted uppercase">app token</div>
                  <div className="text-[14px] font-mono text-foreground">{slack.appToken}</div>
                </div>
                <div className="space-y-1 text-right">
                  <div className="text-[12px] font-mono text-muted uppercase">channel id</div>
                  <div className="text-[14px] font-mono text-foreground">{slack.channelId || "any joined channel"}</div>
                </div>
              </div>
              {slack.diagnostics?.threadRepliesMayNotWork && (
                <div className="rounded-md bg-amber-900/30 border border-amber-700 p-3 text-[12px] font-mono text-amber-200">
                  <strong>Thread replies may not be working.</strong> The bot has received @mention events but no message events for over an hour. Make sure your Slack app subscribes to <code className="text-amber-400">message.channels</code> and <code className="text-amber-400">message.groups</code> under Event Subscriptions.
                </div>
              )}
              {slack.diagnostics && !slack.diagnostics.threadRepliesMayNotWork && slack.diagnostics.uptimeMs < 3600_000 && (
                <div className="text-[11px] font-mono text-muted">
                  Diagnostics collecting (available after ~1 hour of uptime)
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <span className="flex items-center gap-1.5 text-[12px] font-mono text-green">
                  <span className="h-1.5 w-1.5 rounded-full bg-green" />
                  configured
                </span>
                <button
                  onClick={handleDeleteSlack}
                  className="text-[12px] font-mono text-muted-foreground hover:text-red transition-colors"
                >
                  remove
                </button>
              </div>
            </div>
          ) : (
            <div className="term-card p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-[12px] font-mono text-muted uppercase tracking-wider">bot token</label>
                <input
                  type="password"
                  value={slackBotToken}
                  onChange={(e) => setSlackBotToken(e.target.value)}
                  placeholder="xoxb-..."
                  className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[12px] font-mono text-muted uppercase tracking-wider">app token</label>
                <input
                  type="password"
                  value={slackAppToken}
                  onChange={(e) => setSlackAppToken(e.target.value)}
                  placeholder="xapp-..."
                  className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                />
                <p className="text-[12px] font-mono text-muted">
                  Enable Socket Mode in your Slack app and use an app-level token with the <span className="text-foreground">connections:write</span> scope.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-[12px] font-mono text-muted uppercase tracking-wider">channel id (optional)</label>
                <input
                  type="text"
                  value={slackChannelId}
                  onChange={(e) => setSlackChannelId(e.target.value)}
                  placeholder="C0123456789"
                  className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                />
                <p className="text-[12px] font-mono text-muted">
                  Restrict issue creation to one Slack channel, or leave blank to accept mentions in any channel the bot has joined.
                </p>
              </div>
              <div className="border border-border/50 bg-background/40 px-3 py-3 text-[12px] font-mono text-muted space-y-2">
                <div className="font-bold text-foreground">1. OAuth &amp; Permissions — add these Bot Token Scopes:</div>
                <div className="ml-3 space-y-0.5">
                  <div><span className="text-foreground">app_mentions:read</span>, <span className="text-foreground">channels:history</span>, <span className="text-foreground">groups:history</span>, <span className="text-foreground">chat:write</span></div>
                </div>
                <div className="font-bold text-foreground">2. Event Subscriptions — subscribe to these bot events:</div>
                <div className="ml-3 space-y-0.5">
                  <div><span className="text-foreground">app_mention</span> — for creating new issues via @mention</div>
                  <div><span className="text-foreground">message.channels</span> — for thread replies in public channels</div>
                  <div><span className="text-foreground">message.groups</span> — for thread replies in private channels</div>
                </div>
                <div className="text-amber-400">Without step 2, the bot will not see thread replies unless the user @mentions it.</div>
                <div>Usage: mention the bot with <span className="text-foreground">@bot repo-name: description</span>. All replies should stay in that Slack thread.</div>
              </div>
              <button
                onClick={handleSaveSlack}
                disabled={!slackBotToken.trim() || !slackAppToken.trim() || savingSlack}
                className="flex items-center gap-1.5 border border-accent bg-accent/10 px-4 py-1.5 text-[13px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/20 disabled:opacity-40"
              >
                {savingSlack ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> saving...</>
                ) : (
                  <><Send className="h-3 w-3" /> save &amp; test</>
                )}
              </button>
            </div>
          )}
        </section>

        {/* Telegram Bot Config */}
        <section className="space-y-3">
          <h2 className="text-[14px] font-mono font-bold text-accent uppercase tracking-widest">
            &gt; Telegram Bot Service
          </h2>
          <p className="text-[13px] font-mono text-muted-foreground ml-4">
            Dedicated bot for receiving issues. Must be separate from the notification bot.
          </p>

          {telegram?.configured ? (
            <div className="term-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-[12px] font-mono text-muted uppercase">bot token</div>
                  <div className="text-[14px] font-mono text-foreground">{telegram.botToken}</div>
                </div>
                <div className="space-y-1 text-right">
                  <div className="text-[12px] font-mono text-muted uppercase">chat id</div>
                  <div className="text-[14px] font-mono text-foreground">{telegram.chatId}</div>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <span className="flex items-center gap-1.5 text-[12px] font-mono text-green">
                  <span className="h-1.5 w-1.5 rounded-full bg-green" />
                  configured
                </span>
                <button
                  onClick={handleDeleteTelegram}
                  className="text-[12px] font-mono text-muted-foreground hover:text-red transition-colors"
                >
                  remove
                </button>
              </div>
            </div>
          ) : (
            <div className="term-card p-4 space-y-3">
              {/* Step 1: Enter bot token */}
              {(tgPhase === "idle" || tgPhase === "validating") && (
                <>
                  <div className="space-y-1">
                    <label className="text-[12px] font-mono text-muted uppercase tracking-wider">bot token</label>
                    <input
                      type="password"
                      value={tgBotToken}
                      onChange={(e) => setTgBotToken(e.target.value)}
                      placeholder="123456:ABC-DEF..."
                      className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                      disabled={tgPhase === "validating"}
                    />
                    <p className="text-[12px] font-mono text-muted">
                      Create a bot via <span className="text-muted-foreground">@BotFather</span> on Telegram, then paste the token.
                    </p>
                  </div>
                  <button
                    onClick={handleTgValidate}
                    disabled={!tgBotToken.trim() || tgPhase === "validating"}
                    className="flex items-center gap-1.5 border border-accent bg-accent/10 px-4 py-1.5 text-[13px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/20 disabled:opacity-40"
                  >
                    {tgPhase === "validating" ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> validating...</>
                    ) : (
                      <><Send className="h-3 w-3" /> connect</>
                    )}
                  </button>
                </>
              )}

              {/* Step 2: Waiting for message */}
              {tgPhase === "polling" && tgBotInfo && (
                <>
                  <div className="border border-accent/30 bg-accent/5 px-3 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      <span className="text-[14px] font-mono text-foreground">Waiting for your message...</span>
                    </div>
                    <p className="text-[13px] font-mono text-muted-foreground">
                      Open Telegram and send <code className="text-accent bg-background px-1">/start</code> to{" "}
                      <span className="text-foreground">@{tgBotInfo.botUsername || tgBotInfo.botName}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => { setTgPhase("idle"); setTgBotInfo(null); }}
                    className="text-[12px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="inline h-3 w-3 mr-0.5" /> cancel
                  </button>
                </>
              )}

              {/* Step 2b: Manual chat ID entry (fallback after polling timeout) */}
              {tgPhase === "manual" && (
                <>
                  <div className="border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[13px] font-mono text-amber-400">
                    Could not detect chat automatically. Enter the chat ID manually.
                  </div>
                  <div className="space-y-1">
                    <label className="text-[12px] font-mono text-muted uppercase tracking-wider">chat id</label>
                    <input
                      type="text"
                      value={tgManualChatId}
                      onChange={(e) => setTgManualChatId(e.target.value)}
                      placeholder="-100..."
                      className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTgSave(tgManualChatId)}
                      disabled={!tgManualChatId.trim()}
                      className="flex items-center gap-1.5 border border-accent bg-accent/10 px-4 py-1.5 text-[13px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/20 disabled:opacity-40"
                    >
                      save
                    </button>
                    <button
                      onClick={() => { setTgPhase("idle"); setTgBotInfo(null); }}
                      className="text-[12px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="inline h-3 w-3 mr-0.5" /> cancel
                    </button>
                  </div>
                </>
              )}

              {/* Step 3: Chat detected */}
              {tgPhase === "found" && (
                <>
                  <div className="border border-green/30 bg-green/5 px-3 py-2 text-[13px] font-mono text-green">
                    Chat detected: <span className="text-foreground">{tgChatTitle}</span> ({tgChatId})
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTgSave()}
                      className="flex items-center gap-1.5 border border-accent bg-accent/10 px-4 py-1.5 text-[13px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/20"
                    >
                      <Check className="h-3 w-3" /> save &amp; test
                    </button>
                    <button
                      onClick={() => { setTgPhase("idle"); setTgBotInfo(null); setTgChatId(""); }}
                      className="text-[12px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="inline h-3 w-3 mr-0.5" /> cancel
                    </button>
                  </div>
                </>
              )}

              {/* Saving */}
              {tgPhase === "saving" && (
                <div className="flex items-center gap-2 text-[14px] font-mono text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                  saving and testing...
                </div>
              )}
            </div>
          )}
        </section>

        {/* Repositories */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-mono font-bold text-accent uppercase tracking-widest">
              &gt; Repositories
            </h2>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="text-[12px] font-mono text-accent hover:underline"
            >
              + add repository
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <form onSubmit={handleCreateRepo} className="animate-type-in term-card p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-mono font-bold text-accent uppercase tracking-widest">
                  &gt; new repository
                </span>
                <button type="button" onClick={() => setShowCreate(false)} className="text-muted hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[12px] font-mono text-muted uppercase tracking-wider">name *</label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="my-project"
                    className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[12px] font-mono text-muted uppercase tracking-wider">default branch</label>
                  <input
                    type="text"
                    value={createBranch}
                    onChange={(e) => setCreateBranch(e.target.value)}
                    placeholder="main"
                    className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[12px] font-mono text-muted uppercase tracking-wider">local repo path *</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={createPath}
                    onChange={(e) => setCreatePath(e.target.value)}
                    placeholder="/home/user/projects/my-repo"
                    className="flex-1 border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowBrowseCreate(!showBrowseCreate)}
                    className="flex items-center gap-1 border border-border px-2 py-2 text-[12px] font-mono text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    browse
                  </button>
                </div>
                {showBrowseCreate && (
                  <DirectoryPicker
                    gitOnly
                    onSelect={(path) => { setCreatePath(path); setShowBrowseCreate(false); }}
                    onCancel={() => setShowBrowseCreate(false)}
                  />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[12px] font-mono text-muted uppercase tracking-wider">github url (optional)</label>
                <input
                  type="text"
                  value={createUrl}
                  onChange={(e) => setCreateUrl(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                />
              </div>
              <button
                type="submit"
                disabled={creating}
                className="border border-accent bg-accent/10 px-4 py-1.5 text-[13px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/20 disabled:opacity-40"
              >
                {creating ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}
                create
              </button>
            </form>
          )}

          {/* Repository list */}
          {repos.length === 0 && !showCreate && (
            <div className="text-[13px] font-mono text-muted-foreground ml-4">
              No repositories configured. Add one to start receiving issues.
            </div>
          )}

          {repos.map((repo) => (
            <div key={repo.id} className="term-card p-4">
              {editId === repo.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[12px] font-mono text-muted uppercase">name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground outline-none focus:border-accent"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[12px] font-mono text-muted uppercase">branch</label>
                      <input
                        type="text"
                        value={editBranch}
                        onChange={(e) => setEditBranch(e.target.value)}
                        className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground outline-none focus:border-accent"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[12px] font-mono text-muted uppercase">local path</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editPath}
                        onChange={(e) => setEditPath(e.target.value)}
                        className="flex-1 border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowBrowseEdit(!showBrowseEdit)}
                        className="flex items-center gap-1 border border-border px-2 py-2 text-[12px] font-mono text-muted-foreground hover:text-foreground hover:border-accent/50 transition-colors"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {showBrowseEdit && (
                      <DirectoryPicker
                        gitOnly
                        onSelect={(path) => { setEditPath(path); setShowBrowseEdit(false); }}
                        onCancel={() => setShowBrowseEdit(false)}
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[12px] font-mono text-muted uppercase">github url</label>
                    <input
                      type="text"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleSaveEdit} className="text-green hover:text-green/80">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-accent text-[14px]">&gt;</span>
                      <span className="text-[15px] font-bold text-foreground uppercase tracking-wide">
                        {repo.name}
                      </span>
                      <span className="text-[12px] font-mono text-muted border border-border px-1.5">
                        {repo.defaultBranch}
                      </span>
                    </div>
                    <div className="text-[13px] font-mono text-muted-foreground ml-4">
                      {repo.localRepoPath}
                    </div>
                    {repo.githubRepoUrl && (
                      <div className="text-[12px] font-mono text-muted ml-4">
                        {repo.githubRepoUrl}
                      </div>
                    )}
                    <div className="text-[12px] font-mono text-muted ml-4">
                      {repo.issueCount} issues
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(repo)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteRepo(repo.id)}
                      className="text-muted-foreground hover:text-red transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
