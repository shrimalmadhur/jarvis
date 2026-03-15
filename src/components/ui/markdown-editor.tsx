"use client";

import { useState } from "react";
import { MarkdownView } from "./markdown-view";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputClassName?: string;
  required?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  inputClassName = "",
  required,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<"write" | "preview">("write");

  const tabClass = (active: boolean) =>
    `px-3 py-1 text-[11px] font-mono uppercase tracking-widest transition-colors ${
      active
        ? "text-accent border-b border-accent"
        : "text-muted hover:text-muted-foreground"
    }`;

  return (
    <div>
      <div className="flex gap-1 mb-1.5 border-b border-border/40">
        <button
          type="button"
          className={tabClass(tab === "write")}
          onClick={() => setTab("write")}
        >
          Write
        </button>
        <button
          type="button"
          className={tabClass(tab === "preview")}
          onClick={() => setTab("preview")}
        >
          Preview
        </button>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputClassName} min-h-[140px] text-[13px] resize-y ${tab !== "write" ? "hidden" : ""}`}
        required={required}
      />
      {tab === "preview" && (
        <div className="min-h-[140px] border border-border bg-background px-3 py-2">
          {value.trim() ? (
            <MarkdownView content={value} />
          ) : (
            <p className="text-[13px] text-muted/40 italic font-mono">
              Nothing to preview
            </p>
          )}
        </div>
      )}
    </div>
  );
}
