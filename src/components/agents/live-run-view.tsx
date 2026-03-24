"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Wrench,
  Check,
} from "lucide-react";
import { EventItem, type RunEvent } from "./event-item";

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
