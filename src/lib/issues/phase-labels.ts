/**
 * Shared HP-themed phase labels for the issues pipeline UI.
 *
 * The list-page array is 0-indexed (index 0 = "Pending" / "Awaiting Owl").
 * The detail-page array is 1-indexed (phase 1–7, no Pending entry).
 * Both are derived from the same vocabulary so they stay in sync.
 */

/** Phase labels for the list page (0-indexed, includes Pending at index 0) */
export const PHASE_LABELS = [
  "Awaiting Owl",        // 0: Pending
  "Plotting",            // 1: Planning
  "Veritaserum Test",    // 2: Plan Verification (2 parallel reviewers)
  "Veritaserum Test",    // 3: (Merged into Phase 2 — same label for backward compat)
  "Casting Spell",       // 4: Implementing
  "O.W.L. Tribunal",    // 5: Code Review (3 parallel specialists)
  "Reparo!",            // 6: Code Fix (auto-fix loop)
  "Mischief Managed",   // 7: Creating PR
];

/** Phase definitions for the detail page pipeline bar (1-indexed phases) */
export const PIPELINE_PHASES = [
  { phase: 1, label: "Plotting" },
  { phase: 2, label: "Veritaserum Test" },
  { phase: 3, label: "Veritaserum Test" },  // kept for 7-dot backward compat
  { phase: 4, label: "Casting Spell" },
  { phase: 5, label: "O.W.L. Tribunal" },
  { phase: 6, label: "Reparo!" },
  { phase: 7, label: "Mischief Managed" },
];

/** Display names for the StatusBadge — maps raw DB status values to themed labels */
export const STATUS_DISPLAY_NAMES: Record<string, string> = {
  pending: "awaiting owl",
  planning: "plotting",
  reviewing_plan_1: "veritaserum test",
  reviewing_plan_2: "veritaserum test",  // backward compat
  implementing: "casting spell",
  reviewing_code_1: "o.w.l. tribunal",
  reviewing_code_2: "reparo!",
  creating_pr: "mischief managed",
  completed: "mischief managed",
  failed: "caught by filch",
  waiting_for_input: "awaiting owl",
};
