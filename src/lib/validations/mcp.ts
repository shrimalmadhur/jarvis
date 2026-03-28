import { z } from "zod";

export const mcpServerUpdateSchema = z.object({
  name: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
}).strict();
