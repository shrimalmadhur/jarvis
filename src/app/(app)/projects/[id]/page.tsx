"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Bot,
  Plus,
  Clock,
  Globe,
  Key,
  Check,
  AlertCircle,
  Pencil,
  Trash2,
  Loader2,
  X,
  ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectAgent {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  scheduleHuman: string;
  timezone: string | null;
  envVarCount: number;
  soulExcerpt: string;
  lastRun: {
    status: string;
    createdAt: string | null;
    durationMs: number | null;
    error: string | null;
  } | null;
}

function AgentCard({ agent, projectId, index }: { agent: ProjectAgent; projectId: string; index: number }) {
  const lastRunTime = agent.lastRun?.createdAt
    ? formatDistanceToNow(new Date(agent.lastRun.createdAt), { addSuffix: true })
    : null;
  const duration = agent.lastRun?.durationMs
    ? agent.lastRun.durationMs < 1000
      ? `${agent.lastRun.durationMs}ms`
      : `${(agent.lastRun.durationMs / 1000).toFixed(1)}s`
    : null;

  return (
    <Link href={`/projects/${projectId}/agents/${agent.id}`} className="block group">
      <div
        className={cn(
          "animate-grid-reveal term-card relative overflow-hidden transition-all duration-200",
          "hover:border-accent/40 hover:bg-surface-hover",
          !agent.enabled && "opacity-40 hover:opacity-60"
        )}
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="relative z-10 p-5 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-accent text-[13px]">&gt;</span>
              <span className="text-[15px] font-bold text-foreground tracking-wide uppercase">
                {agent.name}
              </span>
            </div>
            <span
              className={cn(
                "flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider",
                agent.enabled
                  ? "border-green/30 text-green"
                  : "border-border text-muted"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", agent.enabled ? "bg-green status-dot-live" : "bg-muted")} />
              {agent.enabled ? "active" : "paused"}
            </span>
          </div>

          {/* Soul excerpt */}
          <p className="text-[13px] leading-relaxed text-muted-foreground line-clamp-2 ml-4 border-l border-border/60 pl-3">
            {agent.soulExcerpt}
          </p>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
            <span className="flex items-center gap-1 border border-border px-1.5 py-0.5 text-muted-foreground">
              <Clock className="h-2.5 w-2.5 text-muted" />
              {agent.scheduleHuman}
            </span>
            {agent.timezone && (
              <span className="flex items-center gap-1 border border-border px-1.5 py-0.5 text-muted-foreground">
                <Globe className="h-2.5 w-2.5 text-muted" />
                {agent.timezone}
              </span>
            )}
            {agent.envVarCount > 0 && (
              <span className="flex items-center gap-1 border border-border px-1.5 py-0.5 text-muted-foreground">
                <Key className="h-2.5 w-2.5 text-muted" />
                {agent.envVarCount}
              </span>
            )}
          </div>

          {/* Last run */}
          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            {agent.lastRun ? (
              <div className="flex items-center gap-2 text-[12px] font-mono">
                {agent.lastRun.status === "success" ? (
                  <span className="flex items-center gap-1 text-green">
                    <Check className="h-3 w-3" /> ok
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red">
                    <AlertCircle className="h-3 w-3" /> err
                  </span>
                )}
                {lastRunTime && <span className="text-muted">{lastRunTime}</span>}
                {duration && <span className="text-muted">{duration}</span>}
              </div>
            ) : (
              <span className="text-[12px] font-mono text-muted italic">no runs</span>
            )}
            <span className="text-muted opacity-0 group-hover:opacity-100 group-hover:text-accent transition-all">
              <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [projRes, agentsRes] = await Promise.all([
        fetch(`/api/projects/${params.id}`),
        fetch(`/api/projects/${params.id}/agents`),
      ]);
      if (!projRes.ok) { setError("Project not found"); return; }
      const projData = await projRes.json();
      setProject(projData);
      setEditName(projData.name);
      setEditDesc(projData.description || "");
      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        setAgents(agentsData.agents);
      }
    } catch { setError("Failed to load project"); }
    finally { setLoading(false); }
  }, [params.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setProject((prev) => prev ? { ...prev, name: data.name, description: data.description } : prev);
        setEditing(false);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update");
      }
    } catch { setError("Failed to update project"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${params.id}`, { method: "DELETE" });
      if (res.ok) router.push("/projects");
      else setError("Failed to delete project");
    } catch { setError("Failed to delete project"); }
    finally { setDeleting(false); }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-[13px] font-mono text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          loading...
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-[14px] font-mono text-red">[ERROR] {error || "Project not found"}</p>
        <Link href="/projects" className="text-[13px] font-mono text-accent hover:underline">
          <ArrowLeft className="inline h-3 w-3 mr-1" />back
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="page-header">
        <div className="px-8 lg:px-12">
          <div className="animate-fade-in">
            <Link href="/projects" className="inline-flex items-center gap-1.5 text-[13px] font-mono text-muted-foreground hover:text-accent transition-colors group mb-4">
              <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
              projects
            </Link>

            <div className="flex items-start justify-between gap-4">
              {editing ? (
                <div className="flex-1 max-w-xl space-y-2">
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="w-full border border-border bg-background px-3 py-2 text-[16px] font-mono font-bold text-foreground uppercase outline-none focus:border-accent input-focus" autoFocus />
                  <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="description"
                    className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground outline-none focus:border-accent input-focus" />
                  <div className="flex gap-2">
                    <button onClick={handleSave} disabled={saving} className="border border-accent bg-accent/10 px-3 py-1.5 text-[12px] font-mono font-bold text-accent uppercase hover:bg-accent/20 disabled:opacity-40">
                      {saving ? "saving..." : "save"}
                    </button>
                    <button onClick={() => { setEditing(false); setEditName(project.name); setEditDesc(project.description || ""); }}
                      className="border border-border px-3 py-1.5 text-[12px] font-mono text-muted-foreground hover:text-foreground">cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-accent text-[15px] glow-text">&gt;&gt;</span>
                    <h1 className="text-[24px] font-bold tracking-widest text-foreground uppercase glow-text">
                      {project.name}
                    </h1>
                  </div>
                  {project.description && (
                    <p className="text-[13px] font-mono text-muted-foreground mt-1 ml-7">
                      // {project.description}
                    </p>
                  )}
                </div>
              )}

              {!editing && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setEditing(true)} className="border border-border p-2 text-muted-foreground hover:text-accent hover:border-accent transition-colors" title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-mono text-red">rm -rf?</span>
                      <button onClick={handleDelete} disabled={deleting} className="border border-red/30 bg-red/5 px-2 py-1 text-[12px] font-mono text-red hover:bg-red/15 disabled:opacity-40">{deleting ? "..." : "y"}</button>
                      <button onClick={() => setConfirmDelete(false)} className="text-[12px] font-mono text-muted hover:text-foreground">n</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} className="border border-red/20 p-2 text-red/40 hover:text-red hover:border-red/40 transition-colors" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 lg:px-12 py-8 space-y-5">
        {/* Agents header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-mono text-muted uppercase tracking-widest">agents</span>
            <span className="border border-accent/30 bg-accent/5 px-2 py-0.5 text-[12px] font-mono font-bold text-accent">
              {agents.length}
            </span>
          </div>
          <Link
            href={`/projects/${params.id}/agents/new`}
            className="flex h-8 items-center gap-1.5 border border-accent/50 bg-accent/5 px-4 text-[12px] font-mono font-bold text-accent uppercase tracking-wider hover:bg-accent/15 hover:border-accent hover:shadow-[0_0_12px_rgba(232,164,74,0.15)] transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            spawn agent
          </Link>
        </div>

        {error && (
          <div className="animate-type-in border border-red/30 bg-red/5 px-4 py-2.5 text-[13px] font-mono text-red">
            [ERROR] {error}
          </div>
        )}

        {agents.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {agents.map((agent, idx) => (
              <AgentCard key={agent.id} agent={agent} projectId={params.id} index={idx} />
            ))}
          </div>
        ) : (
          <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center border border-dashed border-border">
            <div className="text-[13px] font-mono text-muted-foreground space-y-1">
              <p className="text-muted">$ jarvis --list-agents</p>
              <p>0 agents registered</p>
              <p className="text-muted mt-3">run <span className="text-accent">&quot;spawn agent&quot;</span> to create one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
