import { describe, test, expect } from "bun:test";
import {
  shortenModel,
  extractProjectName,
  decodeProjectDir,
  encodeProjectDir,
  parseJsonlEntries,
} from "../utils";

describe("shortenModel", () => {
  test("opus-4-6 variant", () => {
    expect(shortenModel("claude-opus-4-6-20260101")).toBe("Opus 4.6");
  });

  test("opus-4-5 variant", () => {
    expect(shortenModel("claude-opus-4-5-20260101")).toBe("Opus 4.5");
  });

  test("sonnet-4-6 variant", () => {
    expect(shortenModel("claude-sonnet-4-6-20260101")).toBe("Sonnet 4.6");
  });

  test("sonnet-4-5 variant", () => {
    expect(shortenModel("claude-sonnet-4-5-20260101")).toBe("Sonnet 4.5");
  });

  test("haiku-4-6 variant", () => {
    expect(shortenModel("claude-haiku-4-6-20260101")).toBe("Haiku 4.6");
  });

  test("haiku-4-5 variant", () => {
    expect(shortenModel("claude-haiku-4-5-20260101")).toBe("Haiku 4.5");
  });

  test("opus-4 (no minor version)", () => {
    expect(shortenModel("claude-opus-4-20250514")).toBe("Opus 4");
  });

  test("sonnet-4 (no minor version)", () => {
    expect(shortenModel("claude-sonnet-4-20250514")).toBe("Sonnet 4");
  });

  test("haiku-4 (no minor version)", () => {
    expect(shortenModel("claude-haiku-4-20250514")).toBe("Haiku 4");
  });

  test("<synthetic> returns synthetic", () => {
    expect(shortenModel("<synthetic>")).toBe("synthetic");
  });

  test("unknown model returns unchanged", () => {
    expect(shortenModel("gpt-4o")).toBe("gpt-4o");
    expect(shortenModel("gemini-3-flash")).toBe("gemini-3-flash");
  });

  test("order matters — opus-4-6 matches before opus-4", () => {
    // If the function matched "opus-4" first, it would return "Opus 4" for "opus-4-6"
    expect(shortenModel("claude-opus-4-6-latest")).toBe("Opus 4.6");
  });
});

describe("extractProjectName", () => {
  test("extracts from conductor workspace path", () => {
    const result = extractProjectName("/home/user/conductor/workspaces/workspace1/project1");
    expect(result.projectName).toBe("workspace1/project1");
    expect(result.workspaceName).toBe("project1");
  });

  test("uses basename for regular path", () => {
    const result = extractProjectName("/home/user/my-project");
    expect(result.projectName).toBe("my-project");
    expect(result.workspaceName).toBe("my-project");
  });

  test("handles root-level path", () => {
    const result = extractProjectName("/repo");
    expect(result.projectName).toBe("repo");
    expect(result.workspaceName).toBe("repo");
  });
});

describe("decodeProjectDir", () => {
  test("decodes leading dash to /", () => {
    expect(decodeProjectDir("-home-user-repo")).toBe("/home/user/repo");
  });

  test("all dashes become /", () => {
    expect(decodeProjectDir("-a-b-c")).toBe("/a/b/c");
  });

  test("lossy round-trip: dots become dashes become slashes", () => {
    // encodeProjectDir replaces both / and . with -
    // decodeProjectDir replaces all - with /
    // So .hidden → -hidden → /hidden (lossy)
    const encoded = encodeProjectDir("/path/.hidden");
    const decoded = decodeProjectDir(encoded);
    // Should NOT equal original because . was lost
    expect(decoded).not.toBe("/path/.hidden");
    expect(decoded).toContain("/hidden");
  });
});

describe("encodeProjectDir", () => {
  test("replaces slashes with dashes", () => {
    expect(encodeProjectDir("/home/user/repo")).toBe("-home-user-repo");
  });

  test("replaces dots with dashes", () => {
    expect(encodeProjectDir("/path/.claude")).toBe("-path--claude");
  });

  test("handles complex paths", () => {
    expect(encodeProjectDir("/home/user/repo/.claude/worktrees/slug")).toBe(
      "-home-user-repo--claude-worktrees-slug"
    );
  });
});

describe("parseJsonlEntries", () => {
  test("parses valid JSONL", () => {
    const content = '{"a":1}\n{"b":2}\n{"c":3}';
    const result = parseJsonlEntries<{ a?: number; b?: number; c?: number }>(content);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ a: 1 });
    expect(result[2]).toEqual({ c: 3 });
  });

  test("skips malformed lines", () => {
    const content = '{"a":1}\nnot json\n{"b":2}';
    const result = parseJsonlEntries(content);
    expect(result).toHaveLength(2);
  });

  test("returns empty array for empty string", () => {
    expect(parseJsonlEntries("")).toHaveLength(0);
  });

  test("skips empty lines", () => {
    const content = '{"a":1}\n\n\n{"b":2}';
    const result = parseJsonlEntries(content);
    expect(result).toHaveLength(2);
  });

  test("handles mixed valid and invalid lines", () => {
    const content = '{"ok":true}\n{invalid\n\n{"also":"ok"}\ngarbage';
    const result = parseJsonlEntries(content);
    expect(result).toHaveLength(2);
  });
});
