"use client";

import { cn } from "@/lib/utils";
import {
  Wrench,
  Check,
  AlertCircle,
  MessageSquare,
  Play,
} from "lucide-react";

export interface RunEvent {
  type: "started" | "tool_start" | "tool_result" | "text" | "complete";
  timestamp: number;
  data: Record<string, unknown>;
}

export function EventItem({ event, startTime }: { event: RunEvent; startTime: number }) {
  const relativeTime = `+${Math.floor((event.timestamp - startTime) / 1000)}s`;

  switch (event.type) {
    case "started":
      return (
        <div className="flex items-start gap-3 px-4 py-2.5">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10">
            <Play className="h-2.5 w-2.5 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[14px] text-foreground font-medium">Run started</span>
          </div>
          <span className="shrink-0 font-mono text-[12px] text-muted">{relativeTime}</span>
        </div>
      );

    case "tool_start": {
      const toolName = event.data.toolName as string;
      const toolInput = event.data.toolInput as string | undefined;
      let inputSummary = "";
      if (toolInput) {
        try {
          const parsed = JSON.parse(toolInput);
          if (parsed.command) inputSummary = parsed.command;
          else if (parsed.file_path) inputSummary = parsed.file_path;
          else if (parsed.pattern) inputSummary = parsed.pattern;
          else if (parsed.query) inputSummary = parsed.query;
          else if (parsed.url) inputSummary = parsed.url;
        } catch {
          // not JSON
        }
      }

      return (
        <div className="flex items-start gap-3 px-4 py-2.5">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10">
            <Wrench className="h-2.5 w-2.5 text-accent animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-mono text-[14px] text-accent font-medium">{toolName}</span>
            {inputSummary && (
              <p className="mt-0.5 truncate font-mono text-[13px] text-muted-foreground">
                {inputSummary}
              </p>
            )}
          </div>
          <span className="shrink-0 font-mono text-[12px] text-muted">{relativeTime}</span>
        </div>
      );
    }

    case "tool_result": {
      const toolName = event.data.toolName as string;
      const isError = event.data.isError as boolean;
      const durationMs = event.data.durationMs as number | undefined;

      return (
        <div className="flex items-start gap-3 px-4 py-2.5">
          <div className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            isError ? "bg-red/10" : "bg-green/10"
          )}>
            {isError ? (
              <AlertCircle className="h-2.5 w-2.5 text-red" />
            ) : (
              <Check className="h-2.5 w-2.5 text-green" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn(
                "font-mono text-[14px] font-medium",
                isError ? "text-red" : "text-green"
              )}>
                {toolName}
              </span>
              {durationMs != null && (
                <span className="font-mono text-[12px] text-muted">
                  {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          </div>
          <span className="shrink-0 font-mono text-[12px] text-muted">{relativeTime}</span>
        </div>
      );
    }

    case "text": {
      const text = (event.data.text as string) || "";
      return (
        <div className="flex items-start gap-3 px-4 py-2.5">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10">
            <MessageSquare className="h-2.5 w-2.5 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-relaxed text-muted-foreground line-clamp-4 whitespace-pre-wrap">
              {text}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[12px] text-muted">{relativeTime}</span>
        </div>
      );
    }

    case "complete": {
      const success = event.data.success as boolean;
      const durationMs = event.data.durationMs as number | undefined;
      const toolUseCount = event.data.toolUseCount as number | undefined;
      const duration = durationMs
        ? durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
        : null;

      return (
        <div className="flex items-start gap-3 px-4 py-2.5">
          <div className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            success ? "bg-green/10" : "bg-red/10"
          )}>
            {success ? (
              <Check className="h-3 w-3 text-green" />
            ) : (
              <AlertCircle className="h-3 w-3 text-red" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className={cn(
              "text-[14px] font-medium",
              success ? "text-green" : "text-red"
            )}>
              {success ? "Run completed" : "Run failed"}
            </span>
            <div className="mt-0.5 flex items-center gap-3 text-[13px] text-muted">
              {duration && <span className="font-mono">{duration}</span>}
              {(toolUseCount ?? 0) > 0 && <span>{toolUseCount} tools used</span>}
            </div>
          </div>
          <span className="shrink-0 font-mono text-[12px] text-muted">{relativeTime}</span>
        </div>
      );
    }

    default:
      return null;
  }
}
