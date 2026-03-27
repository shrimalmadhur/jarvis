import { describe, expect, test } from "bun:test";
import {
  PHASE_LABELS,
  PIPELINE_PHASES,
  STATUS_DISPLAY_NAMES,
} from "../phase-labels";

describe("PHASE_LABELS", () => {
  test("has 8 entries (indices 0-7)", () => {
    expect(PHASE_LABELS).toHaveLength(8);
  });

  test("index 0 is the pending/queued phase", () => {
    expect(PHASE_LABELS[0]).toBe("Pending");
  });

  test("last entry is the PR creation phase", () => {
    expect(PHASE_LABELS[7]).toBe("Creating PR");
  });

  test("all entries are non-empty strings", () => {
    for (const label of PHASE_LABELS) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("PIPELINE_PHASES", () => {
  test("has 7 entries (phases 1-7)", () => {
    expect(PIPELINE_PHASES).toHaveLength(7);
  });

  test("phases are numbered 1 through 7", () => {
    const phases = PIPELINE_PHASES.map((p) => p.phase);
    expect(phases).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("labels match PHASE_LABELS at corresponding indices", () => {
    // PIPELINE_PHASES phase N should match PHASE_LABELS[N]
    for (const { phase, label } of PIPELINE_PHASES) {
      expect(label).toBe(PHASE_LABELS[phase]);
    }
  });

  test("all entries have non-empty labels", () => {
    for (const { label } of PIPELINE_PHASES) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("STATUS_DISPLAY_NAMES", () => {
  test("covers all pipeline statuses", () => {
    const expectedStatuses = [
      "pending",
      "planning",
      "reviewing_plan_1",
      "reviewing_plan_2",
      "implementing",
      "reviewing_code_1",
      "reviewing_code_2",
      "creating_pr",
      "completed",
      "failed",
      "waiting_for_input",
    ];
    for (const status of expectedStatuses) {
      expect(STATUS_DISPLAY_NAMES[status]).toBeDefined();
      expect(STATUS_DISPLAY_NAMES[status].length).toBeGreaterThan(0);
    }
  });

  test("completed maps to 'completed'", () => {
    expect(STATUS_DISPLAY_NAMES.completed).toBe("completed");
  });

  test("failed maps to 'failed'", () => {
    expect(STATUS_DISPLAY_NAMES.failed).toBe("failed");
  });

  test("all values are lowercase (for uppercase CSS rendering)", () => {
    for (const [, value] of Object.entries(STATUS_DISPLAY_NAMES)) {
      expect(value).toBe(value.toLowerCase());
    }
  });
});
