"use client";

import { useState, useRef, useCallback } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setValue("");

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  };

  const hasContent = value.trim().length > 0;

  return (
    <div className="relative flex items-end gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors focus-within:border-border-hover">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="Message Jarvis..."
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted disabled:opacity-40"
      />
      <button
        onClick={handleSubmit}
        disabled={!hasContent || disabled}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
          hasContent && !disabled
            ? "bg-accent text-background hover:bg-accent-dim"
            : "bg-surface-raised text-muted"
        )}
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  );
}
