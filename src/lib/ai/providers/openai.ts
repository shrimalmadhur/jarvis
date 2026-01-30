import OpenAI from "openai";
import type { LLMProvider, LLMRequest, LLMResponse, LLMToolCall } from "../types";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private modelName: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
    this.modelName = model || "gpt-4o";
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = request.messages.map(
      (msg) => {
        if (msg.role === "tool") {
          return {
            role: "tool" as const,
            content: msg.content || "",
            tool_call_id: msg.toolCallId || "",
          };
        }
        if (msg.role === "assistant" && msg.toolCalls) {
          return {
            role: "assistant" as const,
            content: msg.content,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          };
        }
        return {
          role: msg.role as "system" | "user" | "assistant",
          content: msg.content || "",
        };
      }
    );

    const tools: OpenAI.ChatCompletionTool[] | undefined = request.tools?.map(
      (t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as Record<string, unknown>,
        },
      })
    );

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
      tools: tools?.length ? tools : undefined,
      tool_choice: request.toolChoice === "none" ? "none" : "auto",
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
    });

    const choice = response.choices[0];
    const message = choice.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCalls: LLMToolCall[] = message.tool_calls
        .filter((tc) => tc.type === "function")
        .map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: (tc as { type: "function"; id: string; function: { name: string; arguments: string } }).function.name,
            arguments: (tc as { type: "function"; id: string; function: { name: string; arguments: string } }).function.arguments,
          },
        }));

      return {
        message: { role: "assistant", content: null, toolCalls },
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
        },
        model: response.model,
        finishReason: "tool_calls",
      };
    }

    return {
      message: { role: "assistant", content: message.content || "" },
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
      },
      model: response.model,
      finishReason: "stop",
    };
  }
}
