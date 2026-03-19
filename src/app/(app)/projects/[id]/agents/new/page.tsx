"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AgentForm } from "@/components/agents/agent-form";
import type { AgentFormData } from "@/components/agents/agent-form";

export default function NewAgentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${params.id}`)
      .then(async (res) => {
        if (!res.ok) {
          setError("Project not found");
          return;
        }
        const data = await res.json();
        setProjectName(data.name);
      })
      .catch(() => setError("Failed to load project"))
      .finally(() => setLoading(false));
  }, [params.id]);

  const handleSubmit = async (data: AgentFormData) => {
    const res = await fetch(`/api/projects/${params.id}/agents`, {
      method: "POST",
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
      throw new Error(err.error || "Failed to create agent");
    }

    const agent = await res.json();
    router.push(`/projects/${params.id}/agents/${agent.id}`);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-[14px] font-mono text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-[15px] font-mono text-red">[ERROR] {error}</p>
        <Link href="/projects" className="text-[14px] font-mono text-accent hover:underline">
          <ArrowLeft className="inline h-3 w-3 mr-1" />back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="page-header">
        <div className="px-8 lg:px-16">
          <div className="animate-fade-in">
            <Link
              href={`/projects/${params.id}`}
              className="inline-flex items-center gap-1.5 text-[14px] font-mono text-muted-foreground hover:text-accent transition-colors group mb-4"
            >
              <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
              back
            </Link>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-accent text-[16px] glow-text">&gt;&gt;</span>
                <h1 className="text-[24px] font-bold tracking-widest text-foreground uppercase glow-text">
                  Summon House-Elf
                </h1>
              </div>
              <p className="text-[14px] font-mono text-muted-foreground mt-1 ml-7">
                // bind a new enchanted servant to {projectName}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 lg:px-16 py-8">
        <div className="border border-border bg-surface p-6">
          <AgentForm onSubmit={handleSubmit} submitLabel="bind" />
        </div>
      </div>
    </div>
  );
}
