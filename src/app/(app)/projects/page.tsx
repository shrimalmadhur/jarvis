"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Plus,
  Bot,
  Loader2,
  X,
  ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Project {
  id: string;
  name: string;
  description: string | null;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
}

function ProjectCard({ project, index }: { project: Project; index: number }) {
  const created = formatDistanceToNow(new Date(project.createdAt), { addSuffix: true });

  return (
    <Link href={`/projects/${project.id}`} className="block group">
      <div
        className="animate-grid-reveal term-card relative overflow-hidden transition-all duration-200 hover:border-accent/40 hover:bg-surface-hover"
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="relative z-10 p-5 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-accent text-[13px]">&gt;</span>
                <span className="text-[15px] font-bold text-foreground tracking-wide uppercase">
                  {project.name}
                </span>
              </div>
              <span className="text-[11px] text-muted font-mono ml-4">{created}</span>
            </div>
            <div className="flex items-center gap-1.5 border border-border px-2 py-0.5">
              <Bot className="h-3 w-3 text-muted-foreground" />
              <span className="text-[12px] font-mono text-muted-foreground">
                {project.agentCount}
              </span>
            </div>
          </div>

          {/* Description */}
          {project.description && (
            <p className="text-[13px] leading-relaxed text-muted-foreground line-clamp-2 ml-4 border-l border-border/60 pl-3">
              {project.description}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            <span className="text-[11px] font-mono text-muted uppercase tracking-wider">
              {project.agentCount} {project.agentCount === 1 ? "agent" : "agents"} registered
            </span>
            <span className="flex items-center gap-1 text-[12px] text-muted opacity-0 group-hover:opacity-100 group-hover:text-accent transition-all">
              open <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
      } else {
        setError("Failed to load projects");
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), description: createDesc.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create project");
        return;
      }
      setCreateName("");
      setCreateDesc("");
      setShowCreate(false);
      await fetchProjects();
    } catch {
      setError("Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="page-header">
        <div className="px-8 lg:px-12">
          <div className="animate-fade-in flex items-end justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-accent text-[13px] glow-text">&gt;&gt;</span>
                <h1 className="text-[22px] font-bold tracking-widest text-foreground uppercase glow-text">
                  Projects
                </h1>
              </div>
              <p className="text-[13px] text-muted-foreground font-mono ml-6">
                // autonomous agent workspaces
              </p>
            </div>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex h-8 items-center gap-1.5 border border-accent/50 bg-accent/5 px-4 text-[13px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/15 hover:border-accent hover:shadow-[0_0_12px_rgba(232,164,74,0.15)]"
            >
              <Plus className="h-3.5 w-3.5" />
              init new
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 lg:px-12 py-8 space-y-6">
        {/* Create Form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="animate-type-in border border-accent/30 bg-surface p-5 space-y-3 max-w-xl"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-mono font-bold text-accent uppercase tracking-widest">
                &gt; init project
              </span>
              <button type="button" onClick={() => setShowCreate(false)} className="text-muted hover:text-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-muted uppercase tracking-wider">name</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="project-name"
                className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none transition-all focus:border-accent input-focus"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-muted uppercase tracking-wider">description</label>
              <input
                type="text"
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="optional description"
                className="w-full border border-border bg-background px-3 py-2 text-[14px] font-mono text-foreground placeholder:text-muted/50 outline-none transition-all focus:border-accent input-focus"
              />
            </div>
            <button
              type="submit"
              disabled={creating || !createName.trim()}
              className="border border-accent bg-accent/10 px-4 py-1.5 text-[12px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/20 disabled:opacity-40"
            >
              {creating ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  creating...
                </span>
              ) : (
                "create"
              )}
            </button>
          </form>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex items-center gap-2 text-[13px] font-mono text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              loading projects...
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="animate-type-in border border-red/30 bg-red/5 px-4 py-2.5 text-[13px] font-mono text-red max-w-xl">
            [ERROR] {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && projects.length === 0 && !showCreate && (
          <div className="animate-fade-in flex flex-col items-center justify-center py-24 text-center">
            <div className="text-[13px] font-mono text-muted-foreground space-y-1">
              <p className="text-muted">$ jarvis --list-projects</p>
              <p className="text-muted-foreground">0 projects found</p>
              <p className="text-muted mt-4">run <span className="text-accent">&quot;init new&quot;</span> to create your first project</p>
            </div>
          </div>
        )}

        {/* Project grid */}
        {projects.length > 0 && (
          <>
            <div className="text-[11px] font-mono text-muted uppercase tracking-wider">
              {projects.length} project{projects.length !== 1 ? "s" : ""} found
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {projects.map((project, idx) => (
                <ProjectCard key={project.id} project={project} index={idx} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
