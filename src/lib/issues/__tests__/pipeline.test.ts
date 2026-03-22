import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { buildWorktreePath } from "../pipeline";

describe("buildWorktreePath", () => {
  test("constructs path under .claude/worktrees/", () => {
    const result = buildWorktreePath("/repos/my-project", "fix-login-bug", "abc12345");
    expect(result).toBe(join("/repos/my-project", ".claude", "worktrees", "fix-login-bug-abc12345"));
  });

  test("does not use .dobby-worktrees", () => {
    const result = buildWorktreePath("/repos/my-project", "some-slug", "deadbeef");
    expect(result).not.toContain(".dobby-worktrees");
    expect(result).toContain(".claude/worktrees/");
  });

  test("handles empty slug", () => {
    const result = buildWorktreePath("/repos/project", "", "abc12345");
    expect(result).toBe(join("/repos/project", ".claude", "worktrees", "-abc12345"));
  });
});
