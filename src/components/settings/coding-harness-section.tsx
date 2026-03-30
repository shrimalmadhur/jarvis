"use client";

import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const HARNESS_OPTIONS = [
  { value: "claude", label: "Claude CLI", description: "Anthropic Claude Code" },
  { value: "codex", label: "Codex CLI", description: "OpenAI Codex" },
] as const;

export function CodingHarnessSection() {
  const [harness, setHarness] = useState("claude");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.default_coding_harness) {
          setHarness(data.default_coding_harness);
        }
      }
    } catch (error) {
      console.error("Error fetching harness setting:", error);
    }
  };

  const saveHarness = async (value: string) => {
    setHarness(value);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_coding_harness: value }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (error) {
      console.error("Error saving harness setting:", error);
    }
    setSaving(false);
  };

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Coding Harness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Choose which CLI agent handles coding tasks (issues pipeline, autonomous agents).
          Can be overridden per-message with <code className="text-xs bg-muted/20 px-1 rounded">[harness:codex]</code> or{" "}
          <code className="text-xs bg-muted/20 px-1 rounded">[harness:claude]</code> at the end of your Slack/Telegram message.
        </p>
        <div className="flex gap-3">
          {HARNESS_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => saveHarness(option.value)}
              disabled={saving}
              className={`flex-1 rounded-lg border px-4 py-3 text-left transition-all ${
                harness === option.value
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-border-hover hover:text-foreground"
              }`}
            >
              <div className="text-sm font-medium">{option.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{option.description}</div>
            </button>
          ))}
        </div>
        {saved && (
          <p className="text-xs text-green">
            Coding harness setting saved
          </p>
        )}
      </CardContent>
    </Card>
  );
}
