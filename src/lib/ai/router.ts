import { db, llmConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { LLMProvider, LLMConfig } from "./types";
import { GeminiProvider } from "./providers/gemini";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";

const DEFAULT_CONFIG: LLMConfig = {
  provider: "gemini",
  model: "gemini-3-flash-preview",
  temperature: 0.7,
};

const providerCache: Map<string, LLMProvider> = new Map();

function getProvider(config: LLMConfig): LLMProvider {
  const key = `${config.provider}:${config.model}`;
  const cached = providerCache.get(key);
  if (cached) return cached;

  let provider: LLMProvider;
  switch (config.provider) {
    case "openai":
      provider = new OpenAIProvider(undefined, config.model);
      break;
    case "anthropic":
      provider = new AnthropicProvider(undefined, config.model);
      break;
    case "gemini":
    default:
      provider = new GeminiProvider(undefined, config.model);
      break;
  }

  providerCache.set(key, provider);
  return provider;
}

/**
 * Resolve LLM config for a given task type.
 * Checks DB for user config, falls back to defaults.
 */
export async function resolveConfig(
  taskType: string = "default"
): Promise<LLMConfig> {
  // Check for task-specific config
  const config = await db.query.llmConfigs.findFirst({
    where: eq(llmConfigs.taskType, taskType),
  });

  if (config) {
    return {
      provider: config.provider as LLMConfig["provider"],
      model: config.model,
      temperature: config.temperature ?? 0.7,
    };
  }

  // Check for default config
  if (taskType !== "default") {
    const defaultConfig = await db.query.llmConfigs.findFirst({
      where: eq(llmConfigs.isDefault, true),
    });

    if (defaultConfig) {
      return {
        provider: defaultConfig.provider as LLMConfig["provider"],
        model: defaultConfig.model,
        temperature: defaultConfig.temperature ?? 0.7,
      };
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Get an LLM provider for a given task type.
 */
export async function getLLMProvider(
  taskType: string = "default"
): Promise<{ provider: LLMProvider; config: LLMConfig }> {
  const config = await resolveConfig(taskType);
  const provider = getProvider(config);
  return { provider, config };
}
