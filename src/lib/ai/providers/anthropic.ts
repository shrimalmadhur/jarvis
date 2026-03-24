import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequest, LLMResponse, LLMToolCall, LLMMessage } from "../types";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private modelName: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.modelName = model || "claude-sonnet-4-20250514";
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content || "")
      .join("\n");

    const messages = this.convertMessages(
      request.messages.filter((m) => m.role !== "system")
    );

    // Convert tools
    const tools: Anthropic.Tool[] | undefined = request.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: request.maxTokens ?? 4096,
      system: system || undefined,
      messages,
      tools: tools?.length ? tools : undefined,
      temperature: request.temperature ?? 0.7,
    });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const textBlocks = response.content.filter((b) => b.type === "text");
    const text = textBlocks.map((b) => b.text).join("");
    const usage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    };

    if (toolUseBlocks.length > 0) {
      const toolCalls: LLMToolCall[] = toolUseBlocks.map((b) => ({
        id: b.id,
        type: "function" as const,
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input),
        },
      }));

      return {
        message: { role: "assistant", content: text || null, toolCalls },
        usage,
        model: response.model,
        finishReason: "tool_calls",
      };
    }

    return {
      message: { role: "assistant", content: text },
      usage,
      model: response.model,
      finishReason: "stop",
    };
  }

  private convertMessages(
    messages: LLMMessage[]
  ): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content || "" });
      } else if (msg.role === "assistant") {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }
        }
        result.push({ role: "assistant", content });
      } else if (msg.role === "tool") {
        result.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId || "",
              content: msg.content || "",
            },
          ],
        });
      }
    }

    return result;
  }
}
