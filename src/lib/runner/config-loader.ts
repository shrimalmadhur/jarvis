import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AgentConfig, AgentDefinition } from "./types";

const AgentConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  schedule: z.string(),
  timezone: z.string().optional(),
  telegram: z.object({
    botToken: z.string(),
    chatId: z.string(),
  }),
  llm: z
    .object({
      provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
      model: z.string().optional(),
      temperature: z.number().optional(),
    })
    .optional(),
  maxTokens: z.number().optional(),
});

/**
 * Resolve ${ENV_VAR} references in a string value.
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
    const envValue = process.env[varName];
    if (!envValue) {
      throw new Error(`Environment variable ${varName} is not set`);
    }
    return envValue;
  });
}

/**
 * Recursively resolve env vars in an object's string values.
 */
function resolveEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === "string") return resolveEnvVars(obj) as T;
  if (Array.isArray(obj)) return obj.map(resolveEnvVarsInObject) as T;
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVarsInObject(value);
    }
    return result as T;
  }
  return obj;
}

interface LoadOptions {
  /** Include disabled agents (default: false) */
  includeDisabled?: boolean;
  /** Resolve ${ENV_VAR} references in config (default: true). Set false for UI to avoid crashes on missing env vars. */
  resolveEnv?: boolean;
}

/**
 * Load all agent definitions from the agents/ directory.
 */
export async function loadAgentDefinitions(
  agentsDir?: string,
  options?: LoadOptions
): Promise<AgentDefinition[]> {
  const { includeDisabled = false, resolveEnv = true } = options || {};
  const dir = agentsDir || path.join(process.cwd(), "agents");

  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const definitions: AgentDefinition[] = [];

  for (const entry of entries) {
    // Skip non-directories and _prefixed directories (like _template)
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;

    const agentDir = path.join(dir, entry.name);
    const configPath = path.join(agentDir, "config.json");
    const soulPath = path.join(agentDir, "soul.md");
    const skillPath = path.join(agentDir, "skill.md");

    // All three files must exist
    if (!fs.existsSync(configPath)) {
      console.warn(`Agent "${entry.name}": missing config.json, skipping`);
      continue;
    }
    if (!fs.existsSync(soulPath)) {
      console.warn(`Agent "${entry.name}": missing soul.md, skipping`);
      continue;
    }
    if (!fs.existsSync(skillPath)) {
      console.warn(`Agent "${entry.name}": missing skill.md, skipping`);
      continue;
    }

    // Parse and validate config
    const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const parseResult = AgentConfigSchema.safeParse(rawConfig);

    if (!parseResult.success) {
      console.warn(
        `Agent "${entry.name}": invalid config.json:`,
        parseResult.error.message
      );
      continue;
    }

    const config = parseResult.data as AgentConfig;

    // Skip disabled agents unless includeDisabled is set
    if (!config.enabled && !includeDisabled) continue;

    // Resolve env vars in config (skip for UI to avoid missing env var crashes)
    const finalConfig = resolveEnv ? resolveEnvVarsInObject(config) : config;

    definitions.push({
      config: finalConfig,
      soul: fs.readFileSync(soulPath, "utf-8"),
      skill: fs.readFileSync(skillPath, "utf-8"),
      directory: agentDir,
    });
  }

  return definitions;
}
