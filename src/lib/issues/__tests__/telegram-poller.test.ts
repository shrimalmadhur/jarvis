import { describe, test, expect } from "bun:test";
import { resolve, join } from "node:path";
import { parseIssueMessage } from "../telegram-poller";
import { getAttachmentsDir } from "../attachments";

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

  // Photo caption support: parseIssueMessage works with any string,
  // so captions from photo messages work identically to text messages
  test("parses /issue command from photo caption", () => {
    const caption = "/issue MyRepo: fix the UI layout as shown in screenshot";
    const result = parseIssueMessage(caption);
    expect(result).toEqual({
      repoName: "MyRepo",
      description: "fix the UI layout as shown in screenshot",
    });
  });

  test("returns null for caption without /issue prefix", () => {
    expect(parseIssueMessage("just a photo description")).toBeNull();
  });
});

describe("getAttachmentsDir", () => {
  test("returns an absolute path", () => {
    const dir = getAttachmentsDir();
    expect(dir).toMatch(/^\//);
  });

  test("returns path sibling to database directory", () => {
    const dir = getAttachmentsDir();
    expect(dir).toEndWith("/issue-attachments");
  });

  test("uses DATABASE_PATH env var when set", () => {
    const original = process.env.DATABASE_PATH;
    try {
      process.env.DATABASE_PATH = "/custom/path/data/dobby.db";
      const dir = getAttachmentsDir();
      expect(dir).toBe(resolve("/custom/path/data/issue-attachments"));
    } finally {
      if (original !== undefined) {
        process.env.DATABASE_PATH = original;
      } else {
        delete process.env.DATABASE_PATH;
      }
    }
  });

  test("falls back to cwd/data when DATABASE_PATH unset", () => {
    const original = process.env.DATABASE_PATH;
    try {
      delete process.env.DATABASE_PATH;
      const dir = getAttachmentsDir();
      const expected = resolve(join(process.cwd(), "data", "issue-attachments"));
      expect(dir).toBe(expected);
    } finally {
      if (original !== undefined) {
        process.env.DATABASE_PATH = original;
      }
    }
  });
});
