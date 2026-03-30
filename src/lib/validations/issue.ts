import { z } from "zod";

export const createIssueSchema = z.object({
  repositoryId: z.string().min(1, "Repository ID is required"),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().min(1, "Description is required").max(50000),
  harness: z.enum(["claude", "codex"]).optional(),
});
