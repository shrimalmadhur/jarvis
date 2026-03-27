import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "../system-prompt";

describe("buildSystemPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("contains current timestamp in ISO format", () => {
    const before = new Date().toISOString().substring(0, 10); // date portion
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Current time:");
    expect(prompt).toContain(before);
  });

  test("mentions Dobby identity", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Dobby");
  });

  test("documents built-in filesystem tools", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("list_directory");
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("write_file");
    expect(prompt).toContain("get_file_info");
  });

  test("documents time tool", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("get_current_time");
  });

  test("includes guidelines section", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Guidelines:");
    expect(prompt).toContain("concise");
  });
});
