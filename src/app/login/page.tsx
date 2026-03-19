"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/chat");
      } else {
        setError("Invalid password");
        setPassword("");
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground">Dobby</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter password to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              className="input-focus w-full rounded-lg border border-border bg-surface px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
