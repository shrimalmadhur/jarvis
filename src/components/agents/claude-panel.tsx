"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Loader2,
  Check,
  CornerDownLeft,
  X,
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ClaudePanelProps {
  soul: string;
  skill: string;
  agentName: string;
  schedule?: string;
  timezone?: string;
  envVarKeys?: string[];
  enabled?: boolean;
  onApplySoul: (text: string) => void;
  onApplySkill: (text: string) => void;
}

function extractTagContent(text: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function MessageBubble({
  msg,
  onApplySoul,
  onApplySkill,
}: {
  msg: Message;
  onApplySoul: (text: string) => void;
  onApplySkill: (text: string) => void;
}) {
  const soulContent = msg.role === "assistant" ? extractTagContent(msg.content, "soul") : null;
  const skillContent = msg.role === "assistant" ? extractTagContent(msg.content, "skill") : null;
  const [appliedSoul, setAppliedSoul] = useState(false);
  const [appliedSkill, setAppliedSkill] = useState(false);

  return (
    <div
      className={cn(
        "flex",
        msg.role === "user" ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
          msg.role === "user"
            ? "bg-accent/15 text-foreground"
            : "bg-surface-raised border border-border/50 text-muted-foreground"
        )}
      >
        <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>

        {/* Apply buttons */}
        {(soulContent || skillContent) && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/30 pt-2">
            {soulContent && (
              <button
                onClick={() => {
                  onApplySoul(soulContent);
                  setAppliedSoul(true);
                }}
                disabled={appliedSoul}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium transition-colors",
                  appliedSoul
                    ? "bg-green/10 text-green border border-green/20"
                    : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                )}
              >
                {appliedSoul ? (
                  <>
                    <Check className="h-3 w-3" /> Applied to Soul
                  </>
                ) : (
                  "Apply to Soul"
                )}
              </button>
            )}
            {skillContent && (
              <button
                onClick={() => {
                  onApplySkill(skillContent);
                  setAppliedSkill(true);
                }}
                disabled={appliedSkill}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium transition-colors",
                  appliedSkill
                    ? "bg-green/10 text-green border border-green/20"
                    : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                )}
              >
                {appliedSkill ? (
                  <>
                    <Check className="h-3 w-3" /> Applied to Skill
                  </>
                ) : (
                  "Apply to Skill"
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ClaudePanel({
  soul,
  skill,
  agentName,
  schedule,
  timezone,
  envVarKeys,
  enabled,
  onApplySoul,
  onApplySkill,
}: ClaudePanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [input]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    // Build prompt with agent context
    const systemPrompt = [
      `You are helping the user write and refine prompts for an autonomous agent called "${agentName}".`,
      "",
      "## How the agent works",
      "The agent runs via Claude CLI with full tool access (file read/write, bash, web search, etc.).",
      "Each run, the agent gets a system prompt (soul) and a user message containing the task (skill).",
      "",
      "Key capabilities the agent has at runtime:",
      "- **Persistent workspace**: A dedicated directory that survives across runs. The agent can create files, install packages, cache data, etc.",
      "- **Persistent memory**: A `memory.md` file in the workspace that the agent reads at the start and updates at the end of each run. Use this for tracking progress, avoiding repeat work, and learning across runs.",
      "- **Environment variables**: Secrets and API keys injected at runtime (the agent sees the variable names but values are secure).",
      "- **Telegram notifications**: The agent's output can be sent to a Telegram chat after each run.",
      "",
      "## Agent prompts",
      "- **Soul** (system prompt): Defines the agent's personality, behavior, and constraints.",
      "- **Skill** (task instructions): Defines what the agent does on each run. Can include a `## Memory` section to tell the agent what to track in memory.md.",
      "",
      "When suggesting a replacement for the soul, wrap it in <soul>...</soul> tags.",
      "When suggesting a replacement for the skill, wrap it in <skill>...</skill> tags.",
      "Only use these tags when providing complete replacements. For discussion/feedback, just respond normally.",
    ].join("\n");

    const contextParts = [
      "## Current Agent Configuration",
      "",
      `**Name**: ${agentName}`,
      `**Status**: ${enabled !== undefined ? (enabled ? "Active" : "Paused") : "Unknown"}`,
    ];
    if (schedule) contextParts.push(`**Schedule**: \`${schedule}\``);
    if (timezone) contextParts.push(`**Timezone**: ${timezone}`);
    if (envVarKeys && envVarKeys.length > 0) {
      contextParts.push(`**Environment Variables**: ${envVarKeys.map(k => `\`${k}\``).join(", ")}`);
    }
    contextParts.push("");

    const fullPrompt = [
      ...contextParts,
      "## Current Agent Prompts",
      "",
      "### Soul (System Prompt)",
      "````",
      soul,
      "````",
      "",
      "### Skill (Task Instructions)",
      "````",
      skill,
      "````",
      "",
      "## Conversation History",
      ...messages.map((m) => `**${m.role}**: ${m.content}`),
      "",
      `**user**: ${text}`,
    ].join("\n");

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Add empty assistant message immediately so loading dots show
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/claude/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt, systemPrompt }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: "Error: Failed to connect to Claude CLI.",
          };
          return updated;
        });
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        const updateLastMessage = () => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: assistantText,
            };
            return updated;
          });
        };

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "result" && event.text) {
              assistantText = event.text;
              updateLastMessage();
            } else if (event.type === "text" && event.text) {
              assistantText += event.text;
              updateLastMessage();
            } else if (event.type === "error") {
              assistantText += `\n[Error: ${event.text}]`;
              updateLastMessage();
            }
          } catch {
            // skip unparseable
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Remove empty assistant message if aborted before content arrived
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content === "") {
            return prev.slice(0, -1);
          }
          return prev;
        });
      } else {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: "Error: Claude CLI request failed.",
          };
          return updated;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    // Remove empty assistant message if stop was clicked before any content arrived
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.content === "") {
        return prev.slice(0, -1);
      }
      return prev;
    });
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-6 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-accent shadow-lg shadow-accent/20 text-accent-foreground transition-transform hover:scale-105"
        title="Open Claude assistant"
      >
        <Sparkles className="h-4.5 w-4.5" />
      </button>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span className="text-[14px] font-semibold text-foreground">
            Claude Assistant
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-muted hover:text-foreground transition-colors"
          title="Minimize"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="h-6 w-6 text-muted mb-2" />
            <p className="text-[14px] text-muted-foreground">
              Ask Claude to help write or refine your agent&apos;s prompts
            </p>
            <div className="mt-3 space-y-1">
              {[
                "Make the soul more concise",
                "Add error handling to the skill",
                "Write a soul for a news summarizer agent",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    textareaRef.current?.focus();
                  }}
                  className="block w-full rounded-lg border border-border/50 px-2.5 py-1.5 text-[13px] text-muted-foreground text-left transition-colors hover:border-accent/30 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            onApplySoul={onApplySoul}
            onApplySkill={onApplySkill}
          />
        ))}

        {streaming && messages[messages.length - 1]?.content === "" && (
          <div className="flex justify-start">
            <div className="rounded-xl bg-surface-raised border border-border/50 px-3 py-2">
              <div className="flex items-center gap-1">
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                <span className="loading-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border px-3 py-2">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude to help..."
            rows={3}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted outline-none transition-colors focus:border-accent/50"
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red/20 text-red transition-colors hover:bg-red/5"
              title="Stop"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors hover:bg-accent-dim disabled:opacity-30"
              title="Send (Enter)"
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </form>
        <p className="mt-1 text-[12px] text-muted">
          Enter to send, Shift+Enter for newline. Uses Claude CLI.
        </p>
      </div>
    </div>
  );
}
