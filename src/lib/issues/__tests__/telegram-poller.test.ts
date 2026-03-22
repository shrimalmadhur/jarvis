import { describe, test, expect } from "bun:test";
import { parseIssueMessage } from "../telegram-poller";

describe("parseIssueMessage", () => {
  test("parses valid /issue command with colon separator", () => {
    const result = parseIssueMessage("/issue MyRepo: fix the login bug");
    expect(result).toEqual({ repoName: "MyRepo", description: "fix the login bug" });
  });

  test("parses with space separator instead of colon", () => {
    const result = parseIssueMessage("/issue MyRepo fix the login bug");
    expect(result).toEqual({ repoName: "MyRepo", description: "fix the login bug" });
  });

  test("parses multi-line description", () => {
    const result = parseIssueMessage("/issue MyRepo: fix the bug\nDetails: crashes on login");
    expect(result).toEqual({
      repoName: "MyRepo",
      description: "fix the bug\nDetails: crashes on login",
    });
  });

  test("returns null for non-issue messages", () => {
    expect(parseIssueMessage("hello")).toBeNull();
    expect(parseIssueMessage("/start")).toBeNull();
    expect(parseIssueMessage("")).toBeNull();
  });

  test("returns null for /issue without repo name", () => {
    expect(parseIssueMessage("/issue")).toBeNull();
  });

  test("handles repo names with hyphens and numbers", () => {
    const result = parseIssueMessage("/issue my-repo-2: add pagination to API");
    expect(result).toEqual({ repoName: "my-repo-2", description: "add pagination to API" });
  });

  test("trims whitespace from description", () => {
    const result = parseIssueMessage("/issue Repo:   some description with spaces   ");
    expect(result).toEqual({ repoName: "Repo", description: "some description with spaces" });
  });
});
