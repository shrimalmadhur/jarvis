import { describe, test, expect } from "bun:test";
import { createProjectSchema, updateProjectSchema } from "../project";

describe("createProjectSchema", () => {
  test("accepts valid project with name only", () => {
    const result = createProjectSchema.safeParse({ name: "My Project" });
    expect(result.success).toBe(true);
  });

  test("accepts valid project with name and description", () => {
    const result = createProjectSchema.safeParse({
      name: "My Project",
      description: "A test project",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty name", () => {
    const result = createProjectSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects name over 100 chars", () => {
    const result = createProjectSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  test("accepts name at 100 chars", () => {
    const result = createProjectSchema.safeParse({ name: "a".repeat(100) });
    expect(result.success).toBe(true);
  });

  test("description is optional", () => {
    const result = createProjectSchema.safeParse({ name: "test" });
    expect(result.success).toBe(true);
  });

  test("rejects description over 500 chars", () => {
    const result = createProjectSchema.safeParse({
      name: "test",
      description: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  test("accepts description at 500 chars", () => {
    const result = createProjectSchema.safeParse({
      name: "test",
      description: "a".repeat(500),
    });
    expect(result.success).toBe(true);
  });
});

describe("updateProjectSchema", () => {
  test("allows partial fields", () => {
    expect(updateProjectSchema.safeParse({ name: "new" }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ description: "new" }).success).toBe(true);
    expect(updateProjectSchema.safeParse({}).success).toBe(true);
  });

  test("still validates individual fields", () => {
    expect(updateProjectSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
