import type { LLMProvider, LLMMessage } from "@/lib/ai/types";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import type { AgentDefinition, RunResult } from "./types";

const MAX_TOOL_ITERATIONS = 10;
const DEFAULT_PROVIDER = "gemini";
const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Create an LLM provider from agent config.
 */
function createProvider(definition: AgentDefinition): {
  provider: LLMProvider;
  temperature: number;
} {
  const llmConfig = definition.config.llm;
  const providerName = llmConfig?.provider || DEFAULT_PROVIDER;
  const model = llmConfig?.model || DEFAULT_MODEL;
  const temperature = llmConfig?.temperature ?? DEFAULT_TEMPERATURE;

  let provider: LLMProvider;
  switch (providerName) {
    case "openai":
      provider = new OpenAIProvider(undefined, model);
      break;
    case "anthropic":
      provider = new AnthropicProvider(undefined, model);
      break;
    case "gemini":
    default:
      provider = new GeminiProvider(undefined, model);
      break;
  }

  return { provider, temperature };
}

/**
 * Build the user message from skill.md + context.
 */
function buildUserMessage(
  definition: AgentDefinition,
  context?: { recentOutputs?: string[] }
): string {
  const parts: string[] = [];

  // Inject context
  parts.push(`## Context`);
  parts.push(`Today's date: ${new Date().toISOString().split("T")[0]}`);

  if (context?.recentOutputs?.length) {
    parts.push("");
    parts.push(`## Recent outputs (do NOT repeat these topics)`);
    for (const output of context.recentOutputs.slice(0, 10)) {
      // Take first line as topic summary
      const firstLine = output.split("\n")[0].substring(0, 100);
      parts.push(`- ${firstLine}`);
    }
  }

  parts.push("");
  parts.push(definition.skill);

  return parts.join("\n");
}

/**
 * Run an agent task headlessly (no conversation tracking).
 * Returns the result with output text, usage, and timing.
 */
export async function runAgentTask(
  definition: AgentDefinition,
  context?: { recentOutputs?: string[] }
): Promise<RunResult> {
  const startTime = Date.now();
  const { provider, temperature } = createProvider(definition);

  const llmMessages: LLMMessage[] = [
    { role: "system", content: definition.soul },
    { role: "user", content: buildUserMessage(definition, context) },
  ];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let modelName = definition.config.llm?.model || DEFAULT_MODEL;

  try {
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      const response = await provider.chat({
        messages: llmMessages,
        temperature,
        maxTokens: definition.config.maxTokens,
      });

      modelName = response.model;
      totalPromptTokens += response.usage.promptTokens;
      totalCompletionTokens += response.usage.completionTokens;

      // No tools for v1 - agent should always return text
      if (
        response.finishReason === "tool_calls" &&
        response.message.toolCalls?.length
      ) {
        // If the model tries to call tools, tell it no tools are available
        llmMessages.push(response.message);
        for (const toolCall of response.message.toolCalls) {
          llmMessages.push({
            role: "tool",
            toolCallId: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify({
              error: "No tools are available. Please respond with text only.",
            }),
          });
        }
        iterations++;
        continue;
      }

      // Final text response
      const output = response.message.content || "";
      return {
        agentName: definition.config.name,
        success: true,
        output,
        model: modelName,
        tokensUsed: {
          prompt: totalPromptTokens,
          completion: totalCompletionTokens,
        },
        durationMs: Date.now() - startTime,
      };
    }

    // Hit max iterations
    return {
      agentName: definition.config.name,
      success: false,
      output: "",
      model: modelName,
      tokensUsed: {
        prompt: totalPromptTokens,
        completion: totalCompletionTokens,
      },
      durationMs: Date.now() - startTime,
      error: "Max tool iterations reached without text response",
    };
  } catch (error) {
    return {
      agentName: definition.config.name,
      success: false,
      output: "",
      model: modelName,
      tokensUsed: {
        prompt: totalPromptTokens,
        completion: totalCompletionTokens,
      },
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
