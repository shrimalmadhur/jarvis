export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  name?: string;
  // Raw provider-specific parts (e.g. Gemini thought signatures).
  // Preserved through the conversation store so multi-turn tool use works.
  _providerParts?: unknown[];
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMRequest {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  toolChoice?: "auto" | "none" | "required";
}

export interface LLMResponse {
  message: LLMMessage;
  usage: { promptTokens: number; completionTokens: number };
  model: string;
  finishReason: "stop" | "tool_calls" | "length";
}

export interface LLMProvider {
  chat(request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMConfig {
  provider: "gemini" | "openai" | "anthropic";
  model: string;
  temperature?: number;
  maxTokens?: number;
}
