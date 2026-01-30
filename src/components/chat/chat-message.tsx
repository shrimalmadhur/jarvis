import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant" | "tool";
  content: string | null;
  model?: string;
}

export function ChatMessage({ role, content, model }: ChatMessageProps) {
  if (role === "tool" || !content) return null;

  const isUser = role === "user";

  return (
    <div
      className={cn(
        "animate-fade-in flex gap-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
          isUser
            ? "bg-accent/15 text-accent"
            : "bg-surface-raised text-muted-foreground"
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed",
          isUser
            ? "rounded-tr-md bg-user-bubble text-user-bubble-text"
            : "rounded-tl-md bg-assistant-bubble text-assistant-bubble-text"
        )}
      >
        <div className="whitespace-pre-wrap">{content}</div>
        {!isUser && model && (
          <div className="mt-2 font-mono text-[10px] tracking-wide text-muted">
            {model}
          </div>
        )}
      </div>
    </div>
  );
}
