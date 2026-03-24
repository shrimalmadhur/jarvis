"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function extractTagContent(text: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

export function MessageBubble({
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
