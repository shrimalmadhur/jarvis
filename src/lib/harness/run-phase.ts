import { getSetting } from "@/lib/db/app-settings";
import type { HarnessType, HarnessPhaseOpts, HarnessPhaseResult } from "./types";
import { runClaudeHarness } from "./claude-harness";
import { runCodexHarness } from "./codex-harness";

/** Read the global default harness from app settings. Defaults to "claude". */
export function getDefaultHarness(): HarnessType {
  const setting = getSetting("default_coding_harness");
  return setting === "codex" ? "codex" : "claude";
}

/**
 * Unified phase runner — dispatches to the correct harness adapter.
 *
 * Callers pass `harness` to override the global default.
 * Both adapters return the same `HarnessPhaseResult` shape.
 */
export async function runPhase(
  opts: HarnessPhaseOpts & { harness?: HarnessType },
): Promise<HarnessPhaseResult> {
  const harness = opts.harness || getDefaultHarness();
  if (harness === "codex") {
    return runCodexHarness(opts);
  }
  return runClaudeHarness(opts);
}
