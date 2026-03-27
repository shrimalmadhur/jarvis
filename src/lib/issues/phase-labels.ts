/**
 * Shared phase labels for the issues pipeline UI.
 *
 * The list-page array is 0-indexed (index 0 = "Pending").
 * The detail-page array is 1-indexed (phase 1–7, no Pending entry).
 * Both are derived from the same vocabulary so they stay in sync.
 */

/** Phase labels for the list page (0-indexed, includes Pending at index 0) */
export const PHASE_LABELS = [
  "Pending",             // 0: Pending
  "Planning",            // 1: Planning
  "Plan Review",         // 2: Plan Verification (2 parallel reviewers)
  "Plan Review",         // 3: (Merged into Phase 2 — same label for backward compat)
  "Implementing",        // 4: Implementing
  "Code Review",         // 5: Code Review (3 parallel specialists)
  "Auto-fix",            // 6: Code Fix (auto-fix loop)
  "Creating PR",         // 7: Creating PR
];

/** Phase definitions for the detail page pipeline bar (1-indexed phases) */
export const PIPELINE_PHASES = [
  { phase: 1, label: "Planning" },
  { phase: 2, label: "Plan Review" },
  { phase: 3, label: "Plan Review" },  // kept for 7-dot backward compat
  { phase: 4, label: "Implementing" },
  { phase: 5, label: "Code Review" },
  { phase: 6, label: "Auto-fix" },
  { phase: 7, label: "Creating PR" },
];

/** Display names for the StatusBadge — maps raw DB status values to display labels */
export const STATUS_DISPLAY_NAMES: Record<string, string> = {
  pending: "pending",
  planning: "planning",
  reviewing_plan_1: "plan review",
  reviewing_plan_2: "plan review",  // backward compat
  implementing: "implementing",
  reviewing_code_1: "code review",
  reviewing_code_2: "auto-fix",
  creating_pr: "creating pr",
  completed: "completed",
  failed: "failed",
  waiting_for_input: "awaiting input",
};
