import { getSetting, setSetting } from "@/lib/db/app-settings";
import { runPhase } from "@/lib/harness/run-phase";
import type { HarnessPhaseResult } from "@/lib/harness/types";
import { PHASE_TIMEOUT_MS } from "../types";

// Re-export buildClaudeEnv from its canonical location for backward compat
export { buildClaudeEnv } from "@/lib/harness/claude-harness";

export const MAX_FALLBACK_CHARS = 50_000;

// ── Resume capability check (appSettings-cached, globalThis for HMR) ──

const _g = globalThis as unknown as { _resumeCheckPromise?: Promise<boolean>; _resumeCheckAt?: number };
const RESUME_CHECK_IN_MEMORY_TTL = 60 * 60 * 1000; // 1 hour — re-check DB after this

export async function isResumeSupported(): Promise<boolean> {
  // Clear stale in-memory cache so DB TTL takes effect for long-running processes
  if (_g._resumeCheckPromise && _g._resumeCheckAt && Date.now() - _g._resumeCheckAt > RESUME_CHECK_IN_MEMORY_TTL) {
    _g._resumeCheckPromise = undefined;
  }
  if (!_g._resumeCheckPromise) {
    _g._resumeCheckAt = Date.now();
    _g._resumeCheckPromise = doResumeCheck().catch((err) => {
      console.error("[pipeline] Resume check failed, will retry:", err);
      _g._resumeCheckPromise = undefined;
      return false;
    });
  }
  return _g._resumeCheckPromise;
}

async function doResumeCheck(): Promise<boolean> {
  // Check DB cache first (survives process restarts)
  const cached = getSetting("claude-resume-supported");
  const checkedAt = getSetting("claude-resume-checked-at");

  if (cached !== null && checkedAt) {
    const supported = cached === "true";
    const age = Date.now() - new Date(checkedAt).getTime();
    // Cache true for 7 days; cache false for only 1 hour (self-heals after transient failures)
    const ttl = supported ? 7 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    if (age < ttl) {
      console.log(`[pipeline] Resume capability cached: ${supported}`);
      return supported;
    }
  }

  console.log("[pipeline] Checking --resume capability...");

  // Run verification: create a session, then resume it
  const testId = crypto.randomUUID();
  const create = await runPhase({
    workdir: "/tmp",
    prompt: "Reply with exactly: VERIFY_OK",
    timeoutMs: 30_000,
    sessionId: testId,
    harness: "claude",
  });
  if (!create.success || !create.output.includes("VERIFY_OK")) {
    console.log("[pipeline] Resume check: create phase failed, marking unsupported");
    cacheResumeResult(false);
    return false;
  }

  const resume = await runPhase({
    workdir: "/tmp",
    prompt: "Reply with exactly: RESUME_OK",
    timeoutMs: 30_000,
    resumeSessionId: testId,
    harness: "claude",
  });
  const supported = resume.success && resume.output.includes("RESUME_OK");
  console.log(`[pipeline] Resume capability: ${supported}`);
  cacheResumeResult(supported);
  return supported;
}

function cacheResumeResult(supported: boolean) {
  setSetting("claude-resume-supported", String(supported));
  setSetting("claude-resume-checked-at", new Date().toISOString());
}

/**
 * @deprecated Use `runPhase()` from `@/lib/harness/run-phase` directly.
 * This re-export exists for backward compatibility during transition.
 */
export async function runClaudePhase(opts: {
  workdir: string;
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  sessionId?: string;
  resumeSessionId?: string;
}): Promise<HarnessPhaseResult> {
  return runPhase({ ...opts, harness: "claude" });
}
