import { describe, test, expect } from "bun:test";
import { PHASE_STATUS_MAP, ISSUE_STATUSES } from "../types";

describe("PHASE_STATUS_MAP", () => {
  test("all phase statuses are valid IssueStatus values", () => {
    for (const status of Object.values(PHASE_STATUS_MAP)) {
      expect(ISSUE_STATUSES).toContain(status);
    }
  });

  test("covers phases 0-7", () => {
    for (let i = 0; i <= 7; i++) {
      expect(PHASE_STATUS_MAP[i]).toBeDefined();
    }
  });

  test("phase 0 maps to pending", () => {
    expect(PHASE_STATUS_MAP[0]).toBe("pending");
  });

  test("phase 1 maps to planning", () => {
    expect(PHASE_STATUS_MAP[1]).toBe("planning");
  });

  test("phase 7 maps to creating_pr", () => {
    expect(PHASE_STATUS_MAP[7]).toBe("creating_pr");
  });
});

describe("ISSUE_STATUSES", () => {
  test("contains all expected statuses", () => {
    const expected: string[] = [
      "pending", "planning", "reviewing_plan_1", "reviewing_plan_2",
      "implementing", "reviewing_code_1", "reviewing_code_2",
      "creating_pr", "completed", "failed", "waiting_for_input",
    ];
    for (const status of expected) {
      expect(ISSUE_STATUSES as readonly string[]).toContain(status);
    }
  });
});
