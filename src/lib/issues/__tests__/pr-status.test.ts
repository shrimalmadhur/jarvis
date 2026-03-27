import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock node:child_process before importing the module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExecFile = mock((..._args: any[]) => {});
mock.module("node:child_process", () => ({
  execFile: mockExecFile,
}));

// Import after mocking
const { fetchPrStatus } = await import("../pr-status");

describe("fetchPrStatus", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  test("returns 'open' for OPEN state", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify({ state: "OPEN" }) });
    });
    const result = await fetchPrStatus("https://github.com/owner/repo/pull/1");
    expect(result).toBe("open");
  });

  test("returns 'merged' for MERGED state", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify({ state: "MERGED" }) });
    });
    const result = await fetchPrStatus("https://github.com/owner/repo/pull/2");
    expect(result).toBe("merged");
  });

  test("returns 'closed' for CLOSED state", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify({ state: "CLOSED" }) });
    });
    const result = await fetchPrStatus("https://github.com/owner/repo/pull/3");
    expect(result).toBe("closed");
  });

  test("returns null on error", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error("gh not found"));
    });
    const result = await fetchPrStatus("https://github.com/owner/repo/pull/4");
    expect(result).toBeNull();
  });

  test("returns null for invalid JSON", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "not json" });
    });
    const result = await fetchPrStatus("https://github.com/owner/repo/pull/5");
    expect(result).toBeNull();
  });

  test("returns null for unexpected state value", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify({ state: "UNKNOWN" }) });
    });
    const result = await fetchPrStatus("https://github.com/owner/repo/pull/6");
    expect(result).toBeNull();
  });

  test("passes cwd option when provided", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], opts: { cwd?: string }, cb: Function) => {
      cb(null, { stdout: JSON.stringify({ state: "OPEN" }) });
      expect(opts.cwd).toBe("/repos/my-project");
    });
    await fetchPrStatus("https://github.com/owner/repo/pull/7", "/repos/my-project");
  });
});
