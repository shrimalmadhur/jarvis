"use client";

import { useState } from "react";
import { Loader2, Sparkles, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { cronToHuman } from "@/lib/utils/cron";
import { ClaudePanel } from "./claude-panel";
import { MarkdownEditor } from "@/components/ui/markdown-editor";

export interface AgentFormData {
  name: string;
  soul: string;
  skill: string;
  schedule: string;
  timezone: string;
  envVars: Record<string, string>;
  enabled: boolean;
}

interface AgentFormProps {
  initialValues?: Partial<AgentFormData>;
  onSubmit: (data: AgentFormData) => Promise<void>;
  submitLabel: string;
}

const inputClasses =
  "w-full border border-border bg-background px-3 py-2 text-[15px] font-mono text-foreground placeholder:text-muted/40 outline-none transition-all focus:border-accent input-focus";

const labelClasses = "block text-[12px] font-mono text-muted uppercase tracking-widest mb-1";

type EnvVarEntry = { key: string; value: string };

function recordToEntries(record: Record<string, string>): EnvVarEntry[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function entriesToRecord(entries: EnvVarEntry[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { key, value } of entries) {
    if (key.trim()) result[key.trim()] = value;
  }
  return result;
}

function EnvVarsEditor({
  envVars,
  onChange,
}: {
  envVars: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
}) {
  const [entries, setEntries] = useState<EnvVarEntry[]>(() => recordToEntries(envVars));
  const [showValues, setShowValues] = useState<Record<number, boolean>>({});

  const sync = (updated: EnvVarEntry[]) => {
    setEntries(updated);
    onChange(entriesToRecord(updated));
  };

  const addVar = () => sync([...entries, { key: "", value: "" }]);

  const updateKey = (index: number, newKey: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], key: newKey };
    sync(updated);
  };

  const updateValue = (index: number, value: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], value };
    sync(updated);
  };

  const removeVar = (index: number) => {
    sync(entries.filter((_, i) => i !== index));
  };

  const toggleShow = (index: number) => {
    setShowValues((p) => ({ ...p, [index]: !p[index] }));
  };

  return (
    <div className="space-y-1.5">
      {entries.map((entry, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-1.5">
          <input
            type="text"
            value={entry.key}
            onChange={(e) => updateKey(idx, e.target.value)}
            placeholder="KEY_NAME"
            className={`${inputClasses} uppercase`}
          />
          <input
            type={showValues[idx] ? "text" : "password"}
            value={entry.value}
            onChange={(e) => updateValue(idx, e.target.value)}
            placeholder="value"
            className={`${inputClasses} ${entry.value.includes("****") ? "border-yellow-500/40" : ""}`}
            title={entry.value.includes("****") ? "This value is masked. Edit to replace with the real value, or leave as-is to keep the stored value." : undefined}
          />
          <button type="button" onClick={() => toggleShow(idx)} className="border border-border p-1.5 text-muted hover:text-foreground hover:border-accent transition-colors">
            {showValues[idx] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
          <button type="button" onClick={() => removeVar(idx)} className="border border-red/20 p-1.5 text-red/40 hover:text-red hover:border-red/40 transition-colors">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addVar}
        className="flex items-center gap-1.5 border border-dashed border-border px-3 py-1.5 text-[13px] font-mono text-muted-foreground hover:border-accent/30 hover:text-accent transition-colors"
      >
        <Plus className="h-3 w-3" />
        add variable
      </button>
    </div>
  );
}

export function AgentForm({ initialValues, onSubmit, submitLabel }: AgentFormProps) {
  const [form, setForm] = useState<AgentFormData>({
    name: initialValues?.name || "",
    soul: initialValues?.soul || "",
    skill: initialValues?.skill || "",
    schedule: initialValues?.schedule || "0 8 * * *",
    timezone: initialValues?.timezone || "",
    envVars: initialValues?.envVars || {},
    enabled: initialValues?.enabled ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClaude, setShowClaude] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: keyof AgentFormData, value: string | number | boolean | Record<string, string>) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="border border-red/30 bg-red/5 px-3 py-2 text-[14px] font-mono text-red">
          [ERROR] {error}
        </div>
      )}

      {/* Name + Enabled */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className={labelClasses}>agent name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="my-agent"
            className={inputClasses}
            required
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-[13px] font-mono text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => update("enabled", e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            active
          </label>
        </div>
      </div>

      {/* Soul */}
      <div>
        <label className={labelClasses}>system prompt // soul</label>
        <MarkdownEditor
          value={form.soul}
          onChange={(v) => update("soul", v)}
          placeholder="You are an autonomous agent that..."
          inputClassName={inputClasses}
          required
        />
      </div>

      {/* Skill */}
      <div>
        <label className={labelClasses}>task instructions // skill</label>
        <MarkdownEditor
          value={form.skill}
          onChange={(v) => update("skill", v)}
          placeholder="Generate a daily report about..."
          inputClassName={inputClasses}
          required
        />
      </div>

      {/* Schedule + Timezone */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>schedule // cron</label>
          <input
            type="text"
            value={form.schedule}
            onChange={(e) => update("schedule", e.target.value)}
            placeholder="0 8 * * *"
            className={inputClasses}
            required
          />
          <p className="mt-1 text-[12px] font-mono text-accent/60">
            {cronToHuman(form.schedule)}
          </p>
        </div>
        <div>
          <label className={labelClasses}>timezone</label>
          <input
            type="text"
            value={form.timezone}
            onChange={(e) => update("timezone", e.target.value)}
            placeholder="America/Los_Angeles"
            className={inputClasses}
          />
        </div>
      </div>

      {/* Environment Variables */}
      <div>
        <label className={labelClasses}>env vars // credentials</label>
        <p className="text-[12px] font-mono text-muted mb-2">
          api keys and secrets injected at runtime
        </p>
        <EnvVarsEditor
          envVars={form.envVars}
          onChange={(vars) => update("envVars", vars)}
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="border border-accent bg-accent/10 px-5 py-2 text-[14px] font-mono font-bold text-accent uppercase tracking-wider transition-all hover:bg-accent/20 hover:shadow-[0_0_12px_rgba(124,58,237,0.15)] disabled:opacity-40"
        >
          {submitting ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              deploying...
            </span>
          ) : (
            `> ${submitLabel}`
          )}
        </button>
        {!showClaude && (
          <button
            type="button"
            onClick={() => setShowClaude(true)}
            className="flex items-center gap-1.5 border border-accent/30 px-4 py-2 text-[14px] font-mono text-accent/70 transition-all hover:border-accent hover:text-accent hover:shadow-[0_0_12px_rgba(124,58,237,0.1)]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            ask claude
          </button>
        )}
      </div>
    </form>
  );

  if (!showClaude) return formContent;

  return (
    <div className="flex gap-4 -mx-6 -mb-6 -mt-2">
      <div className="flex-1 min-w-0 px-6 pb-6 pt-2 overflow-y-auto">
        {formContent}
      </div>
      <div className="w-[520px] shrink-0 border-l border-border">
        <ClaudePanel
          soul={form.soul}
          skill={form.skill}
          agentName={form.name || "unnamed"}
          schedule={form.schedule}
          timezone={form.timezone}
          envVarKeys={Object.keys(form.envVars).filter(k => k.trim())}
          enabled={form.enabled}
          onApplySoul={(text) => update("soul", text)}
          onApplySkill={(text) => update("skill", text)}
        />
      </div>
    </div>
  );
}
