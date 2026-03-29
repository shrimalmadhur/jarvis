import { describe, test, expect } from "bun:test";
import { parseSlackIssueMessage, getSlackEventDiagnostics, isSlackSocketConnected } from "../slack-socket";

describe("parseSlackIssueMessage", () => {
  test("parses valid message with colon separator", () => {
    const result = parseSlackIssueMessage("dobby: fix the login bug");
    expect(result).toEqual({ repoName: "dobby", description: "fix the login bug" });
  });

  test("strips slack mentions before parsing", () => {
    const result = parseSlackIssueMessage("<@U12345ABC> dobby: fix the login bug");
    expect(result).toEqual({ repoName: "dobby", description: "fix the login bug" });
  });

  test("strips multiple mentions", () => {
    const result = parseSlackIssueMessage("<@U12345ABC> <@U67890DEF> dobby: fix it");
    expect(result).toEqual({ repoName: "dobby", description: "fix it" });
  });

  test("parses with space separator instead of colon", () => {
    const result = parseSlackIssueMessage("my-repo fix the bug");
    expect(result).toEqual({ repoName: "my-repo", description: "fix the bug" });
  });

  test("parses multi-line description", () => {
    const result = parseSlackIssueMessage("dobby: fix the bug\nDetails: crashes on login");
    expect(result).toEqual({
      repoName: "dobby",
      description: "fix the bug\nDetails: crashes on login",
    });
  });

  test("returns null for empty text", () => {
    expect(parseSlackIssueMessage("")).toBeNull();
  });

  test("returns null for mention-only text", () => {
    expect(parseSlackIssueMessage("<@U12345ABC>")).toBeNull();
  });

  test("handles repo names with hyphens and numbers", () => {
    const result = parseSlackIssueMessage("my-repo-2: add pagination");
    expect(result).toEqual({ repoName: "my-repo-2", description: "add pagination" });
  });
});

describe("getSlackEventDiagnostics", () => {
  test("returns initial state with no events seen", () => {
    const diag = getSlackEventDiagnostics();
    // On fresh module load, no events have been processed yet
    expect(diag).toHaveProperty("appMentionSeen");
    expect(diag).toHaveProperty("messageSeen");
    expect(diag).toHaveProperty("threadRepliesMayNotWork");
    expect(diag).toHaveProperty("uptimeMs");
    expect(typeof diag.uptimeMs).toBe("number");
    expect(diag.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  test("threadRepliesMayNotWork is false when no events seen", () => {
    const diag = getSlackEventDiagnostics();
    // Can't be true if no app_mention seen
    expect(diag.threadRepliesMayNotWork).toBe(false);
  });
});

describe("isSlackSocketConnected", () => {
  test("returns false when no socket exists", () => {
    expect(isSlackSocketConnected()).toBe(false);
  });
});
