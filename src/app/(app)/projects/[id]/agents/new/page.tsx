"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AgentForm } from "@/components/agents/agent-form";
import type { AgentFormData } from "@/components/agents/agent-form";

export default function NewAgentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="page-header">
        <div className="px-8 lg:px-12">
          <div className="animate-fade-in">
            <Link
              href={`/projects/${params.id}`}
              className="inline-flex items-center gap-1.5 text-[13px] font-mono text-muted-foreground hover:text-accent transition-colors group mb-4"
            >
              <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
              back
            </Link>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-accent text-[15px] glow-text">&gt;&gt;</span>
                <h1 className="text-[22px] font-bold tracking-widest text-foreground uppercase glow-text">
                  Spawn Agent
                </h1>
              </div>
              <p className="text-[13px] font-mono text-muted-foreground mt-1 ml-7">
                // configure a new autonomous agent
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 lg:px-12 py-8">
        <div className="border border-border bg-surface p-6 max-w-4xl">
          <AgentForm onSubmit={handleSubmit} submitLabel="deploy" />
        </div>
      </div>
    </div>
  );
}
