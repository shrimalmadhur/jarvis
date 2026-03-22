import { z } from "zod";

// Strict validation to prevent shell injection via paths/branch names
const safePathRegex = /^\/[a-zA-Z0-9._\/ -]+$/;
const safeBranchRegex = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/;

export const createRepositorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  githubRepoUrl: z.string().url("Invalid URL").optional().or(z.literal("")),
  localRepoPath: z.string()
    .min(1, "Local repo path is required")
    .regex(safePathRegex, "Path must be absolute and contain only safe characters"),
  defaultBranch: z.string()
    .min(1).max(100)
    .regex(safeBranchRegex, "Branch name contains invalid characters")
    .default("main"),
});

export const updateRepositorySchema = createRepositorySchema.partial();
