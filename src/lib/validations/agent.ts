import { z } from "zod";

const cronRegex = /^(\S+\s+){4}\S+$/;
const envKeyRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DENIED_ENV_KEYS = new Set([
  "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS",
  "HOME", "SHELL", "USER", "LOGNAME", "DYLD_INSERT_LIBRARIES",
]);

export const createAgentSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  soul: z.string().min(1, "System prompt is required").max(50000, "System prompt too long (max 50,000 chars)"),
  skill: z.string().min(1, "Task instructions are required").max(50000, "Task instructions too long (max 50,000 chars)"),
  schedule: z.string().min(1).regex(cronRegex, "Invalid cron expression (expected 5 fields)"),
  timezone: z.string().optional(),
  envVars: z.record(z.string(), z.string()).optional().transform((vars) => {
    if (!vars) return vars;
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      const key = k.trim();
      if (!key) continue;
      if (!envKeyRegex.test(key)) continue;
      if (DENIED_ENV_KEYS.has(key.toUpperCase())) continue;
      cleaned[key] = v;
    }
    return cleaned;
  }),
  enabled: z.boolean().optional(),
});

export const updateAgentSchema = createAgentSchema.partial();
