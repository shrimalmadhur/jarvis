"use client";

import { useState } from "react";
import { Plus, Trash2, Eye, EyeOff } from "lucide-react";

const inputClasses =
  "w-full border border-border bg-background px-3 py-2 text-[15px] font-mono text-foreground placeholder:text-muted/40 outline-none transition-all focus:border-accent input-focus";

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

export function EnvVarsEditor({
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
