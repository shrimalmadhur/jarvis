import { cn } from "@/lib/utils";
import { Wand2, User } from "lucide-react";

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
        "animate-fade-in flex gap-4",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          isUser
            ? "bg-accent/15 text-accent"
            : "bg-surface-raised border border-border text-muted-foreground"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed",
          isUser
            ? "rounded-tr-lg bg-user-bubble text-user-bubble-text shadow-sm shadow-accent/10"
            : "rounded-tl-lg bg-assistant-bubble text-assistant-bubble-text border border-border/50"
        )}
      >
        <div className="whitespace-pre-wrap">{content}</div>
        {!isUser && model && (
          <div className="mt-2.5 font-mono text-[12px] tracking-wide text-muted">
            {model}
          </div>
        )}
      </div>
    </div>
  );
}
