export async function register() {
  // Only run in the Node.js server runtime (which is Bun in production).
  // Skip in Edge runtime and during builds where bun:sqlite is unavailable.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // globalThis.process may not exist in Edge runtime (guarded above)
  if (!globalThis.process?.versions?.bun) return;

  const { ensurePollerRunning } = await import("@/lib/issues/poller-manager");
  ensurePollerRunning();
}
