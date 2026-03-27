import { describe, test, expect, mock, beforeEach } from "bun:test";

// Capture args passed to messages.create
let capturedCreateArgs: unknown = null;
let createResponse: unknown = null;

const mockCreate = mock(async (args: unknown) => {
  capturedCreateArgs = args;
  return createResponse;
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

const { AnthropicProvider } = await import("../anthropic");

beforeEach(() => {
  capturedCreateArgs = null;
  mockCreate.mockClear();
});

function makeTextResponse(text: string, model = "claude-sonnet-4-20250514") {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 12, output_tokens: 18 },
    model,
  };
}

function makeToolUseResponse(
  blocks: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  model = "claude-sonnet-4-20250514"
) {
  return {
    content: blocks.map((b) => ({
      type: "tool_use",
      id: b.id,
      name: b.name,
      input: b.input,
    })),
    usage: { input_tokens: 10, output_tokens: 5 },
    model,
  };
}

describe("AnthropicProvider", () => {
  describe("message conversion", () => {
    test("system messages are filtered and passed via system parameter", async () => {
      createResponse = makeTextResponse("ok");
      const provider = new AnthropicProvider("key", "claude-test");
      await provider.chat({
        messages: [
          { role: "system", content: "Be helpful" },
          { role: "user", content: "Hello" },
        ],
      });

      const args = capturedCreateArgs as {
        system: string;
        messages: Array<{ role: string; content: unknown }>;
      };
      expect(args.system).toBe("Be helpful");
      // System messages should not appear in messages array
      expect(args.messages.every((m) => m.role !== "system")).toBe(true);
    });

    test("assistant with toolCalls becomes tool_use content blocks", async () => {
      createResponse = makeTextResponse("done");
      const provider = new AnthropicProvider("key", "claude-test");
      await provider.chat({
        messages: [
          { role: "user", content: "Hi" },
          {
            role: "assistant",
            content: "Let me check",
            toolCalls: [{
              id: "toolu_123",
              type: "function" as const,
              function: { name: "get_time", arguments: '{"tz":"UTC"}' },
            }],
          },
          { role: "user", content: "Thanks" },
        ],
      });

      const args = capturedCreateArgs as {
        messages: Array<{ role: string; content: unknown }>;
      };
      const assistantMsg = args.messages[1];
      expect(assistantMsg.role).toBe("assistant");
      const content = assistantMsg.content as Array<Record<string, unknown>>;
      // Should have text block + tool_use block
      expect(content[0]).toEqual({ type: "text", text: "Let me check" });
      expect(content[1]).toEqual({
        type: "tool_use",
        id: "toolu_123",
        name: "get_time",
        input: { tz: "UTC" },
      });
    });

    test("tool role becomes user message with tool_result content block", async () => {
      createResponse = makeTextResponse("got it");
      const provider = new AnthropicProvider("key", "claude-test");
      await provider.chat({
        messages: [
          { role: "user", content: "Hi" },
          { role: "tool", content: "the result", toolCallId: "toolu_123" },
        ],
      });

      const args = capturedCreateArgs as {
        messages: Array<{ role: string; content: unknown }>;
      };
      const toolMsg = args.messages[1];
      expect(toolMsg.role).toBe("user");
      const content = toolMsg.content as Array<Record<string, unknown>>;
      expect(content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "toolu_123",
        content: "the result",
      });
    });

    test("user messages pass through with content string", async () => {
      createResponse = makeTextResponse("ok");
      const provider = new AnthropicProvider("key", "claude-test");
      await provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      const args = capturedCreateArgs as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(args.messages[0].role).toBe("user");
      expect(args.messages[0].content).toBe("Hello");
    });
  });

  describe("tool conversion", () => {
    test("converts LLMToolDefinition to Anthropic format with input_schema", async () => {
      createResponse = makeTextResponse("ok");
      const provider = new AnthropicProvider("key", "claude-test");
      await provider.chat({
        messages: [{ role: "user", content: "Hi" }],
        tools: [{
          name: "get_weather",
          description: "Get weather info",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        }],
      });

      const args = capturedCreateArgs as {
        tools: Array<{ name: string; description: string; input_schema: unknown }>;
      };
      expect(args.tools).toHaveLength(1);
      expect(args.tools[0].name).toBe("get_weather");
      expect(args.tools[0].description).toBe("Get weather info");
      expect(args.tools[0].input_schema).toEqual({
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      });
    });
  });

  describe("response parsing", () => {
    test("text response returns stop finishReason", async () => {
      createResponse = makeTextResponse("Hello!");
      const provider = new AnthropicProvider("key", "claude-test");
      const response = await provider.chat({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(response.message.role).toBe("assistant");
      expect(response.message.content).toBe("Hello!");
      expect(response.finishReason).toBe("stop");
      expect(response.usage.promptTokens).toBe(12);
      expect(response.usage.completionTokens).toBe(18);
    });

    test("tool_use response returns tool_calls finishReason with block.id", async () => {
      createResponse = makeToolUseResponse([
        { id: "toolu_abc", name: "search", input: { query: "weather" } },
      ]);
      const provider = new AnthropicProvider("key", "claude-test");
      const response = await provider.chat({
        messages: [{ role: "user", content: "Search" }],
      });

      expect(response.finishReason).toBe("tool_calls");
      expect(response.message.toolCalls).toHaveLength(1);
      const tc = response.message.toolCalls![0];
      expect(tc.id).toBe("toolu_abc");
      expect(tc.type).toBe("function");
      expect(tc.function.name).toBe("search");
      expect(JSON.parse(tc.function.arguments)).toEqual({ query: "weather" });
    });

    test("mixed text and tool_use response", async () => {
      createResponse = {
        content: [
          { type: "text", text: "Let me search" },
          { type: "tool_use", id: "toolu_1", name: "search", input: { q: "test" } },
        ],
        usage: { input_tokens: 10, output_tokens: 15 },
        model: "claude-test",
      };
      const provider = new AnthropicProvider("key", "claude-test");
      const response = await provider.chat({
        messages: [{ role: "user", content: "Find something" }],
      });

      expect(response.finishReason).toBe("tool_calls");
      expect(response.message.content).toBe("Let me search");
      expect(response.message.toolCalls).toHaveLength(1);
    });
  });
});
