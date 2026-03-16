import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  readWorkspaceMemory,
  formatMemoryForPrompt,
  extractMemorySection,
  hasWorkspaceArchive,
  parseSubAgentOutput,
  MEMORY_CONTEXT_NOTE,
} from "../agent-memory";

const TEST_WORKSPACE = join(import.meta.dir, ".tmp-test-workspace");

beforeEach(() => {
  mkdirSync(TEST_WORKSPACE, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true });
});

describe("readWorkspaceMemory", () => {
  test("returns empty string for missing file", () => {
    expect(readWorkspaceMemory(TEST_WORKSPACE)).toBe("");
  });

  test("returns file contents when memory.md exists", () => {
    writeFileSync(join(TEST_WORKSPACE, "memory.md"), "## Topics\n- Apples\n");
    expect(readWorkspaceMemory(TEST_WORKSPACE)).toBe("## Topics\n- Apples");
  });

  test("truncates files exceeding MAX_MEMORY_CHARS (16000)", () => {
    const longContent = "x".repeat(20000);
    writeFileSync(join(TEST_WORKSPACE, "memory.md"), longContent);
    const result = readWorkspaceMemory(TEST_WORKSPACE);
    // 16000 chars of content + truncation suffix (~50 chars)
    expect(result.length).toBeLessThanOrEqual(16100);
    expect(result.length).toBeGreaterThan(16000);
    expect(result).toContain("[memory truncated");
  });

  test("returns empty string for non-existent workspace dir", () => {
    expect(readWorkspaceMemory("/tmp/nonexistent-workspace-xyz")).toBe("");
  });
});

describe("formatMemoryForPrompt", () => {
  test("returns empty string for empty content", () => {
    expect(formatMemoryForPrompt("")).toBe("");
  });

  test("wraps content with heading and separators", () => {
    const result = formatMemoryForPrompt("## Topics\n- Apples");
    expect(result).toContain("## Your Memory (from previous runs)");
    expect(result).toContain("---");
    expect(result).toContain("## Topics\n- Apples");
  });

  test("includes usage guidance", () => {
    const result = formatMemoryForPrompt("some memory");
    expect(result).toContain("avoid repeating work");
  });

  test("mentions archive when hasArchive is true", () => {
    const result = formatMemoryForPrompt("some memory", true);
    expect(result).toContain("memory-archive.md");
    expect(result).toContain("Detailed history");
  });

  test("does not mention archive when hasArchive is false", () => {
    const result = formatMemoryForPrompt("some memory", false);
    expect(result).not.toContain("memory-archive.md");
  });
});

describe("hasWorkspaceArchive", () => {
  test("returns false when no archive exists", () => {
    expect(hasWorkspaceArchive(TEST_WORKSPACE)).toBe(false);
  });

  test("returns true when memory-archive.md exists", () => {
    writeFileSync(join(TEST_WORKSPACE, "memory-archive.md"), "## Archived\n- old item\n");
    expect(hasWorkspaceArchive(TEST_WORKSPACE)).toBe(true);
  });
});

describe("extractMemorySection", () => {
  test("extracts ## Memory section from skill text", () => {
    const skill = [
      "## Task",
      "Do something interesting.",
      "",
      "## Memory",
      "Track which ingredients you've analyzed.",
      "Track the scores given.",
      "",
      "## Output Format",
      "Use markdown.",
    ].join("\n");

    const result = extractMemorySection(skill);
    expect(result).toBe("Track which ingredients you've analyzed.\nTrack the scores given.");
  });

  test("returns null when no Memory section exists", () => {
    const skill = "## Task\nDo something.\n\n## Output Format\nMarkdown.";
    expect(extractMemorySection(skill)).toBeNull();
  });

  test("handles Memory section at end of text", () => {
    const skill = "## Task\nDo stuff.\n\n## Memory\nTrack topics covered.";
    const result = extractMemorySection(skill);
    expect(result).toBe("Track topics covered.");
  });

  test("handles empty Memory section", () => {
    const skill = "## Task\nDo stuff.\n\n## Memory\n\n## Output\nMarkdown.";
    expect(extractMemorySection(skill)).toBeNull();
  });

  test("is case-insensitive for heading", () => {
    const skill = "## MEMORY\nTrack items.";
    expect(extractMemorySection(skill)).toBe("Track items.");
  });
});

describe("MEMORY_CONTEXT_NOTE", () => {
  test("does NOT contain write instructions (only prohibition)", () => {
    const lower = MEMORY_CONTEXT_NOTE.toLowerCase();
    // Should NOT tell the agent HOW to write memory
    expect(lower).not.toContain("update `./memory.md`");
    expect(lower).not.toContain("write_file");
    expect(lower).not.toContain("bash echo");
    expect(lower).not.toContain("before your final response");
    // Should explicitly tell the agent NOT to write
    expect(lower).toContain("do not write to memory.md");
    expect(lower).toContain("handled automatically");
  });

  test("mentions memory is handled automatically", () => {
    expect(MEMORY_CONTEXT_NOTE.toLowerCase()).toContain("handled automatically");
  });

  test("references previous runs section", () => {
    expect(MEMORY_CONTEXT_NOTE).toContain("Your Memory (from previous runs)");
  });
});

describe("parseSubAgentOutput", () => {
  test("returns memory only when no delimiter present", () => {
    const result = parseSubAgentOutput("## Items\n- Apple\n- Banana", true);
    expect(result.memory).toBe("## Items\n- Apple\n- Banana");
    expect(result.archive).toBeUndefined();
  });

  test("splits on delimiter when compaction requested", () => {
    const output = "## Items (2 total)\n- Recent\n---ARCHIVE---\n## Archived on 2026-03-16\n- Old item";
    const result = parseSubAgentOutput(output, true);
    expect(result.memory).toBe("## Items (2 total)\n- Recent");
    expect(result.archive).toBe("## Archived on 2026-03-16\n- Old item");
  });

  test("ignores delimiter when compaction NOT requested", () => {
    const output = "## Items\n---ARCHIVE---\nshould not split";
    const result = parseSubAgentOutput(output, false);
    expect(result.memory).toBe("## Items\n---ARCHIVE---\nshould not split");
    expect(result.archive).toBeUndefined();
  });

  test("handles empty memory part with placeholder", () => {
    const output = "---ARCHIVE---\n## Archived\n- everything moved";
    const result = parseSubAgentOutput(output, true);
    expect(result.memory).toContain("compacted");
    expect(result.archive).toBe("## Archived\n- everything moved");
  });

  test("handles delimiter at end (no archive content)", () => {
    const output = "## Items\n- Recent\n---ARCHIVE---";
    const result = parseSubAgentOutput(output, true);
    expect(result.memory).toBe("## Items\n- Recent");
    expect(result.archive).toBeUndefined();
  });

  test("returns empty memory for empty input", () => {
    expect(parseSubAgentOutput("", true).memory).toBe("");
    expect(parseSubAgentOutput("  ", true).memory).toBe("");
  });

  test("does not match delimiter inside inline text", () => {
    const output = "Use ---ARCHIVE--- delimiter for splitting\n## Items\n- Apple";
    const result = parseSubAgentOutput(output, true);
    // The regex requires the delimiter to be on its own line
    expect(result.memory).toBe(output);
    expect(result.archive).toBeUndefined();
  });
});
