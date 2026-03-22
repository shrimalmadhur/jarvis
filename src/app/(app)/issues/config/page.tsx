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
} from "lucide-react";

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

export default function IssuesConfigPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [telegram, setTelegram] = useState<TelegramConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPath, setCreatePath] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [createBranch, setCreateBranch] = useState("main");
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editBranch, setEditBranch] = useState("");

  // Telegram form
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgSaving, setTgSaving] = useState(false);

  async function fetchAll() {
    try {
      const [repoRes, tgRes] = await Promise.all([
        fetch("/api/issues/projects"),
        fetch("/api/issues/telegram"),
      ]);
      if (repoRes.ok) {
        const data = await repoRes.json();
        setRepos(data.repositories);
      }
      if (tgRes.ok) {
        const data = await tgRes.json();
        setTelegram(data);
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
  }

  async function handleSaveTelegram(e: React.FormEvent) {
    e.preventDefault();
    if (!tgBotToken.trim() || !tgChatId.trim()) return;
    setTgSaving(true);
    try {
      const res = await fetch("/api/issues/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken: tgBotToken.trim(),
          chatId: tgChatId.trim(),
          test: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        showError(data.error || "Failed to save Telegram config");
        return;
      }
      setTgBotToken("");
      setTgChatId("");
      showSuccess("Telegram bot configured and tested");
      await fetchAll();
    } catch {
      showError("Failed to save Telegram config");
    } finally {
      setTgSaving(false);
    }
  }

  async function handleDeleteTelegram() {
    try {
      await fetch("/api/issues/telegram", { method: "DELETE" });
      showSuccess("Telegram config removed");
      await fetchAll();
    } catch {
      showError("Failed to remove Telegram config");
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
                Issue Config
              </h1>
            </div>
            <p className="text-[14px] text-muted-foreground font-mono ml-6 mt-1">
              // repositories and telegram bot setup
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

        {/* Telegram Bot Config */}
        <section className="space-y-3">
          <h2 className="text-[14px] font-mono font-bold text-accent uppercase tracking-widest">
            &gt; Telegram Issues Bot
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
            <form onSubmit={handleSaveTelegram} className="term-card p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-[12px] font-mono text-muted uppercase tracking-wider">bot token</label>
                <input
                  type="password"
                  value={tgBotToken}
                  onChange={(e) => setTgBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                  className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[12px] font-mono text-muted uppercase tracking-wider">chat id</label>
                <input
                  type="text"
                  value={tgChatId}
                  onChange={(e) => setTgChatId(e.target.value)}
                  placeholder="-100..."
                  className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={tgSaving}
                className="flex items-center gap-1.5 border border-accent bg-accent/10 px-4 py-1.5 text-[13px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/20 disabled:opacity-40"
              >
                {tgSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                test &amp; save
              </button>
            </form>
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
                <input
                  type="text"
                  value={createPath}
                  onChange={(e) => setCreatePath(e.target.value)}
                  placeholder="/home/user/projects/my-repo"
                  className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none focus:border-accent"
                  required
                />
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
                    <input
                      type="text"
                      value={editPath}
                      onChange={(e) => setEditPath(e.target.value)}
                      className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground outline-none focus:border-accent"
                    />
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
