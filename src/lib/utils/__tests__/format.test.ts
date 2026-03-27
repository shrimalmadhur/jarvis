import { describe, test, expect } from "bun:test";
import { formatDuration } from "../format";

describe("formatDuration", () => {
  test("formats 0ms", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  test("formats sub-second values as milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1)).toBe("1ms");
  });

  test("formats 1000ms as seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
  });

  test("formats larger values as seconds with one decimal", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(60000)).toBe("60.0s");
    expect(formatDuration(12345)).toBe("12.3s");
  });
});
