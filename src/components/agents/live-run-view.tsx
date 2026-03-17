"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Wrench,
  Check,
  AlertCircle,
  MessageSquare,
  Play,
} from "lucide-react";

interface RunEvent {
  type: "started" | "tool_start" | "tool_result" | "text" | "complete";
  timestamp: number;
  data: Record<string, unknown>;
}

interface LiveRunViewProps {
  agentId: string;
  running: boolean;
  onComplete: () => void;
}

function formatElapsed(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
}

function EventItem({ event, startTime }: { event: RunEvent; startTime: number }) {
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
          // Show a brief summary of the input
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

export function LiveRunView({ agentId, running, onComplete }: LiveRunViewProps) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState("0s");
  const scrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(Date.now());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Connect to SSE stream when running
  useEffect(() => {
    if (!running) return;

    setEvents([]);
    startTimeRef.current = Date.now();

    const es = new EventSource(`/api/agents/${encodeURIComponent(agentId)}/run/stream`);

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const event: RunEvent = JSON.parse(e.data);
        if (event.type === "started") {
          startTimeRef.current = event.timestamp;
        }
        setEvents((prev) => [...prev, event]);

        if (event.type === "complete") {
          es.close();
          setConnected(false);
          onCompleteRef.current();
        }
      } catch {
        // invalid event
      }
    };

    // Close on error to prevent auto-reconnect (which replays all events as duplicates)
    es.onerror = () => {
      es.close();
      setConnected(false);
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [agentId, running]);

  // Update elapsed timer
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setElapsed(formatElapsed(startTimeRef.current));
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  if (!running && events.length === 0) return null;

  const isComplete = events.some((e) => e.type === "complete");
  const toolCount = events.filter((e) => e.type === "tool_start").length;

  return (
    <div className="animate-fade-in rounded-2xl border border-accent/30 bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-accent/20 bg-accent/5">
        {running && !isComplete ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        ) : isComplete ? (
          <Check className="h-4 w-4 text-green" />
        ) : null}
        <span className="text-[15px] font-bold uppercase tracking-[0.15em] text-accent">
          {running && !isComplete ? "Live Activity" : "Run Complete"}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[13px] text-muted">
          {toolCount > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="h-3 w-3" />
              {toolCount}
            </span>
          )}
          <span className="font-mono">{elapsed}</span>
          {running && !isComplete && connected && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green status-dot-live" />
              <span className="text-green">LIVE</span>
            </span>
          )}
        </div>
      </div>

      {/* Events list */}
      <div
        ref={scrollRef}
        className="max-h-[400px] overflow-y-auto divide-y divide-border/20"
      >
        {events.length === 0 && running && (
          <div className="flex items-center gap-2 px-4 py-6 justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
            <span className="text-[14px] text-muted">Connecting to agent...</span>
          </div>
        )}
        {events.map((event, idx) => (
          <EventItem
            key={idx}
            event={event}
            startTime={startTimeRef.current}
          />
        ))}
      </div>
    </div>
  );
}
