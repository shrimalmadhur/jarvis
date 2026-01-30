import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclarationSchema, SchemaType } from "@google/generative-ai";
import type { LLMProvider, LLMRequest, LLMResponse, LLMMessage, LLMToolCall } from "../types";

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || "";
    this.client = new GoogleGenerativeAI(key);
    this.modelName = model || "gemini-3-flash-preview";
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
    });

    // Convert messages to Gemini format
    const { systemInstruction, contents } = this.convertMessages(request.messages);

    // Convert tools
    const tools = request.tools?.length
      ? [{
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: {
              type: SchemaType.OBJECT,
              properties: (t.parameters as { properties?: Record<string, unknown> }).properties || {},
              ...((t.parameters as { required?: string[] }).required
                ? { required: (t.parameters as { required?: string[] }).required }
                : {}),
            } as FunctionDeclarationSchema,
          })),
        }]
      : undefined;

    const result = await model.generateContent({
      contents,
      systemInstruction: systemInstruction || undefined,
      tools,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
      },
    });

    const response = result.response;
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Check for function calls
    const functionCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => p.text);

    if (functionCalls.length > 0) {
      const toolCalls: LLMToolCall[] = functionCalls.map((p, i) => ({
        id: `call_${Date.now()}_${i}`,
        type: "function" as const,
        function: {
          name: p.functionCall!.name,
          arguments: JSON.stringify(p.functionCall!.args),
        },
      }));

      return {
        message: {
          role: "assistant",
          content: null,
          toolCalls,
          // Preserve ALL raw parts (including thought signatures for Gemini 3+)
          // so we can replay them verbatim in multi-turn conversations.
          _providerParts: parts as unknown[],
        },
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        },
        model: this.modelName,
        finishReason: "tool_calls",
      };
    }

    const text = textParts.map((p) => p.text).join("");

    return {
      message: { role: "assistant", content: text },
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
      model: this.modelName,
      finishReason: "stop",
    };
  }

  private convertMessages(messages: LLMMessage[]): {
    systemInstruction: string | null;
    contents: Content[];
  } {
    let systemInstruction: string | null = null;
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = msg.content || "";
        continue;
      }

      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content || "" }],
        });
      } else if (msg.role === "assistant") {
        // If we have raw provider parts (with thought signatures etc.),
        // use them directly to preserve Gemini 3+ required fields.
        if (msg._providerParts && msg._providerParts.length > 0) {
          contents.push({
            role: "model",
            parts: msg._providerParts as Part[],
          });
        } else {
          const parts: Part[] = [];
          if (msg.content) {
            parts.push({ text: msg.content });
          }
          if (msg.toolCalls) {
            for (const tc of msg.toolCalls) {
              parts.push({
                functionCall: {
                  name: tc.function.name,
                  args: JSON.parse(tc.function.arguments),
                },
              });
            }
          }
          if (parts.length > 0) {
            contents.push({ role: "model", parts });
          }
        }
      } else if (msg.role === "tool") {
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: msg.name || "unknown",
                response: { result: msg.content },
              },
            },
          ],
        });
      }
    }

    return { systemInstruction, contents };
  }
}
