import { describe, test, expect } from "bun:test";
import { createRepositorySchema, updateRepositorySchema } from "../repository";

describe("createRepositorySchema", () => {
  const validRepo = {
    name: "my-repo",
    localRepoPath: "/home/user/projects/my-repo",
    defaultBranch: "main",
  };

  test("accepts valid repository", () => {
    const result = createRepositorySchema.safeParse(validRepo);
    expect(result.success).toBe(true);
  });

  test("accepts repository with github URL", () => {
    const result = createRepositorySchema.safeParse({
      ...validRepo,
      githubRepoUrl: "https://github.com/user/repo",
    });
    expect(result.success).toBe(true);
  });

  test("accepts empty string for optional githubRepoUrl", () => {
    const result = createRepositorySchema.safeParse({
      ...validRepo,
      githubRepoUrl: "",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid githubRepoUrl", () => {
    const result = createRepositorySchema.safeParse({
      ...validRepo,
      githubRepoUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  describe("localRepoPath validation", () => {
    test("must start with /", () => {
      const result = createRepositorySchema.safeParse({
        ...validRepo,
        localRepoPath: "relative/path",
      });
      expect(result.success).toBe(false);
    });

    test("accepts valid absolute paths", () => {
      for (const path of ["/home/user/repo", "/var/lib/project", "/tmp/test-repo"]) {
        const result = createRepositorySchema.safeParse({ ...validRepo, localRepoPath: path });
        expect(result.success).toBe(true);
      }
    });

    test("accepts paths with dots, hyphens, and spaces", () => {
      const result = createRepositorySchema.safeParse({
        ...validRepo,
        localRepoPath: "/home/user/my project/v1.0",
      });
      expect(result.success).toBe(true);
    });

    test("rejects paths with unsafe characters", () => {
      for (const p of ["/path;cmd", "/path$(evil)", "/path&bg"]) {
        const result = createRepositorySchema.safeParse({ ...validRepo, localRepoPath: p });
        expect(result.success).toBe(false);
      }
    });
  });

  describe("defaultBranch validation", () => {
    test("accepts common branch names", () => {
      for (const branch of ["main", "master", "develop", "feature/my-branch", "release/v1.0"]) {
        const result = createRepositorySchema.safeParse({ ...validRepo, defaultBranch: branch });
        expect(result.success).toBe(true);
      }
    });

    test("defaults to main when not provided", () => {
      const result = createRepositorySchema.parse({
        name: "repo",
        localRepoPath: "/home/user/repo",
      });
      expect(result.defaultBranch).toBe("main");
    });

    test("rejects branch starting with special char", () => {
      const result = createRepositorySchema.safeParse({ ...validRepo, defaultBranch: "-branch" });
      expect(result.success).toBe(false);
    });
  });
});

describe("updateRepositorySchema", () => {
  test("allows partial fields", () => {
    expect(updateRepositorySchema.safeParse({ name: "new" }).success).toBe(true);
    expect(updateRepositorySchema.safeParse({}).success).toBe(true);
  });
});
