"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ConversationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("Conversation error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="animate-fade-in text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red/10">
          <AlertTriangle className="h-6 w-6 text-red" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Couldn&apos;t load conversation
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {error.message || "This conversation may have been deleted or is unavailable."}
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-surface-raised px-4 py-2 text-sm text-foreground transition-colors hover:bg-surface-hover"
          >
            Retry
          </button>
          <button
            onClick={() => router.push("/chat")}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            New chat
          </button>
        </div>
      </div>
    </div>
  );
}
