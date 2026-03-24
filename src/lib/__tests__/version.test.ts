import { describe, expect, test, beforeEach } from "bun:test";
import { getVersion } from "../version";

describe("getVersion", () => {
  beforeEach(() => {
    delete process.env.GIT_TAG;
    delete process.env.GIT_BRANCH;
    delete process.env.GIT_COMMIT;
  });

  test("tag takes priority over branch and commit", () => {
    process.env.GIT_TAG = "v1.2.0";
    process.env.GIT_BRANCH = "HEAD";
    process.env.GIT_COMMIT = "abc1234";
    const v = getVersion();
    expect(v.label).toBe("v1.2.0");
    expect(v.tag).toBe("v1.2.0");
  });

  test("branch + commit when no tag", () => {
    process.env.GIT_TAG = "";
    process.env.GIT_BRANCH = "main";
    process.env.GIT_COMMIT = "0b7b0f2";
    const v = getVersion();
    expect(v.label).toBe("main@0b7b0f2");
    expect(v.branch).toBe("main");
    expect(v.commit).toBe("0b7b0f2");
  });

  test("feature branch with commit", () => {
    process.env.GIT_TAG = "";
    process.env.GIT_BRANCH = "feat/version-display";
    process.env.GIT_COMMIT = "d3adb33";
    const v = getVersion();
    expect(v.label).toBe("feat/version-display@d3adb33");
  });

  test("HEAD branch (detached) filtered to empty — shows commit only", () => {
    process.env.GIT_TAG = "";
    process.env.GIT_BRANCH = "HEAD";
    process.env.GIT_COMMIT = "abc1234";
    const v = getVersion();
    expect(v.label).toBe("abc1234");
    expect(v.branch).toBe("");
  });

  test("HEAD branch with tag — tag wins", () => {
    process.env.GIT_TAG = "v0.3.0";
    process.env.GIT_BRANCH = "HEAD";
    process.env.GIT_COMMIT = "abc1234";
    const v = getVersion();
    expect(v.label).toBe("v0.3.0");
  });

  test("branch only, no commit", () => {
    process.env.GIT_TAG = "";
    process.env.GIT_BRANCH = "dev";
    process.env.GIT_COMMIT = "";
    const v = getVersion();
    expect(v.label).toBe("dev");
  });

  test("commit only, no branch or tag", () => {
    process.env.GIT_TAG = "";
    process.env.GIT_BRANCH = "";
    process.env.GIT_COMMIT = "deadbeef";
    const v = getVersion();
    expect(v.label).toBe("deadbeef");
  });

  test("all empty — fallback to dev", () => {
    process.env.GIT_TAG = "";
    process.env.GIT_BRANCH = "";
    process.env.GIT_COMMIT = "";
    const v = getVersion();
    expect(v.label).toBe("dev");
  });

  test("env vars not set at all — fallback to dev", () => {
    // All deleted in beforeEach
    const v = getVersion();
    expect(v.label).toBe("dev");
  });
});
