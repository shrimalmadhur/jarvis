export async function register() {
  // Guard: only run in the bun server runtime. Next.js build runs under
  // Node.js where bun:sqlite is unavailable — the dynamic import below
  // would eventually pull in the DB module and crash.
  if (!process.versions.bun) return;

  const { ensurePollerRunning } = await import("@/lib/issues/poller-manager");
  ensurePollerRunning();
}
