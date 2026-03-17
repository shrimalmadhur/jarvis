"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";

export default function SessionDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("Session detail error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface border border-border">
        <AlertCircle className="h-5 w-5 text-red" />
      </div>
      <p className="text-sm text-muted-foreground">
        {error.message || "Failed to load session details."}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-surface-raised px-4 py-2 text-sm text-foreground transition-colors hover:bg-surface-hover"
        >
          Retry
        </button>
        <button
          onClick={() => router.push("/sessions")}
          className="inline-flex items-center gap-1.5 text-[13px] text-accent transition-colors hover:text-accent-dim"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Sessions
        </button>
      </div>
    </div>
  );
}
