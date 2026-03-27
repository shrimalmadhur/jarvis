import { describe, test, expect } from "bun:test";
import { createIssueSchema } from "../issue";

describe("createIssueSchema", () => {
  const validIssue = {
    repositoryId: "repo-1",
    title: "Fix the bug",
    description: "The bug is in the login flow.",
  };

  test("accepts valid issue", () => {
    const result = createIssueSchema.safeParse(validIssue);
    expect(result.success).toBe(true);
  });

  test("rejects empty repositoryId", () => {
    const result = createIssueSchema.safeParse({ ...validIssue, repositoryId: "" });
    expect(result.success).toBe(false);
  });

  test("rejects empty title", () => {
    const result = createIssueSchema.safeParse({ ...validIssue, title: "" });
    expect(result.success).toBe(false);
  });

  test("rejects title over 200 chars", () => {
    const result = createIssueSchema.safeParse({ ...validIssue, title: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  test("accepts title at 200 chars", () => {
    const result = createIssueSchema.safeParse({ ...validIssue, title: "a".repeat(200) });
    expect(result.success).toBe(true);
  });

  test("rejects empty description", () => {
    const result = createIssueSchema.safeParse({ ...validIssue, description: "" });
    expect(result.success).toBe(false);
  });

  test("rejects description over 50000 chars", () => {
    const result = createIssueSchema.safeParse({ ...validIssue, description: "a".repeat(50001) });
    expect(result.success).toBe(false);
  });

  test("accepts description at 50000 chars", () => {
    const result = createIssueSchema.safeParse({ ...validIssue, description: "a".repeat(50000) });
    expect(result.success).toBe(true);
  });

  test("rejects missing required fields", () => {
    expect(createIssueSchema.safeParse({}).success).toBe(false);
    expect(createIssueSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(createIssueSchema.safeParse({ repositoryId: "x", title: "x" }).success).toBe(false);
  });
});
