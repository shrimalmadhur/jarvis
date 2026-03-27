import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_TOOLS,
  BUILTIN_TOOL_NAMES,
  executeBuiltinTool,
} from "../builtin-tools";

const TEST_DIR = join(import.meta.dir, ".tmp-test-builtin-tools");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("BUILTIN_TOOLS", () => {
  test("has exactly 5 entries", () => {
    expect(BUILTIN_TOOLS).toHaveLength(5);
  });

  test("includes all expected tool names", () => {
    const names = BUILTIN_TOOLS.map((t) => t.name);
    expect(names).toContain("get_current_time");
    expect(names).toContain("list_directory");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("get_file_info");
  });

  test("each tool has name, description, and parameters", () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
    }
  });
});

describe("BUILTIN_TOOL_NAMES", () => {
  test("matches BUILTIN_TOOLS names", () => {
    expect(BUILTIN_TOOL_NAMES.size).toBe(BUILTIN_TOOLS.length);
    for (const tool of BUILTIN_TOOLS) {
      expect(BUILTIN_TOOL_NAMES.has(tool.name)).toBe(true);
    }
  });
});

describe("executeBuiltinTool", () => {
  describe("get_current_time", () => {
    test("returns parseable time JSON", async () => {
      const result = await executeBuiltinTool("get_current_time", {});
      const parsed = JSON.parse(result);
      expect(parsed.time).toBeDefined();
      expect(parsed.timezone).toBe("UTC");
      expect(parsed.iso).toBeDefined();
    });

    test("respects timezone parameter", async () => {
      const result = await executeBuiltinTool("get_current_time", { timezone: "America/New_York" });
      const parsed = JSON.parse(result);
      expect(parsed.timezone).toBe("America/New_York");
    });

    test("falls back to UTC on invalid timezone", async () => {
      const result = await executeBuiltinTool("get_current_time", { timezone: "Invalid/Zone" });
      const parsed = JSON.parse(result);
      expect(parsed.timezone).toBe("UTC");
    });
  });

  describe("list_directory", () => {
    test("lists files in directory", async () => {
      writeFileSync(join(TEST_DIR, "file1.txt"), "hello");
      writeFileSync(join(TEST_DIR, "file2.txt"), "world");
      mkdirSync(join(TEST_DIR, "subdir"));

      const result = await executeBuiltinTool("list_directory", { path: TEST_DIR });
      const parsed = JSON.parse(result);
      expect(parsed.count).toBe(3);
      const names = parsed.entries.map((e: { name: string }) => e.name);
      expect(names).toContain("file1.txt");
      expect(names).toContain("file2.txt");
      expect(names).toContain("subdir");
    });

    test("includes file sizes", async () => {
      writeFileSync(join(TEST_DIR, "sized.txt"), "12345");
      const result = await executeBuiltinTool("list_directory", { path: TEST_DIR });
      const parsed = JSON.parse(result);
      const file = parsed.entries.find((e: { name: string }) => e.name === "sized.txt");
      expect(file.type).toBe("file");
      expect(file.size).toBe(5);
    });

    test("returns error for nonexistent directory", async () => {
      const result = await executeBuiltinTool("list_directory", { path: "/nonexistent-dir-xyz" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });

  describe("read_file", () => {
    test("reads file content", async () => {
      const filePath = join(TEST_DIR, "test.txt");
      writeFileSync(filePath, "Hello, World!");
      const result = await executeBuiltinTool("read_file", { path: filePath });
      const parsed = JSON.parse(result);
      expect(parsed.content).toBe("Hello, World!");
      expect(parsed.size).toBe(13);
      expect(parsed.truncated).toBe(false);
    });

    test("truncates with maxBytes", async () => {
      const filePath = join(TEST_DIR, "big.txt");
      writeFileSync(filePath, "Hello, World!");
      const result = await executeBuiltinTool("read_file", { path: filePath, maxBytes: 5 });
      const parsed = JSON.parse(result);
      expect(parsed.content).toBe("Hello");
      expect(parsed.truncated).toBe(true);
    });

    test("returns error for nonexistent file", async () => {
      const result = await executeBuiltinTool("read_file", { path: "/nonexistent-file-xyz" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });

  describe("write_file", () => {
    test("writes file content", async () => {
      const filePath = join(TEST_DIR, "output.txt");
      const result = await executeBuiltinTool("write_file", { path: filePath, content: "written!" });
      const parsed = JSON.parse(result);
      expect(parsed.written).toBe(true);
      expect(parsed.size).toBe(8);
    });

    test("creates parent directories", async () => {
      const filePath = join(TEST_DIR, "deep", "nested", "dir", "file.txt");
      const result = await executeBuiltinTool("write_file", { path: filePath, content: "deep" });
      const parsed = JSON.parse(result);
      expect(parsed.written).toBe(true);
    });
  });

  describe("get_file_info", () => {
    test("returns metadata for file", async () => {
      const filePath = join(TEST_DIR, "info.txt");
      writeFileSync(filePath, "test content");
      const result = await executeBuiltinTool("get_file_info", { path: filePath });
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe("file");
      expect(parsed.size).toBe(12);
      expect(parsed.created).toBeDefined();
      expect(parsed.modified).toBeDefined();
      expect(parsed.permissions).toBeDefined();
    });

    test("returns metadata for directory", async () => {
      const result = await executeBuiltinTool("get_file_info", { path: TEST_DIR });
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe("directory");
    });

    test("returns error for nonexistent path", async () => {
      const result = await executeBuiltinTool("get_file_info", { path: "/nonexistent-xyz" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });

  describe("unknown tool", () => {
    test("returns error for unknown tool name", async () => {
      const result = await executeBuiltinTool("unknown_tool", {});
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("Unknown built-in tool");
    });
  });
});
