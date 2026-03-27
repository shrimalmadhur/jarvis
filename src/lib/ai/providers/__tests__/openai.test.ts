import { describe, test, expect, mock, beforeEach } from "bun:test";

// Capture args passed to create
let capturedCreateArgs: unknown = null;
let createResponse: unknown = null;

const mockCreate = mock(async (args: unknown) => {
  capturedCreateArgs = args;
  return createResponse;
});

mock.module("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

const { OpenAIProvider } = await import("../openai");

beforeEach(() => {
  capturedCreateArgs = null;
  mockCreate.mockClear();
});

function makeTextResponse(text: string, model = "gpt-4o") {
  return {
    choices: [{ message: { content: text, tool_calls: null } }],
    usage: { prompt_tokens: 15, completion_tokens: 25 },
    model,
  };
}

function makeToolCallResponse(
  calls: Array<{ id: string; name: string; arguments: string }>,
  model = "gpt-4o"
) {
  return {
    choices: [{
      message: {
        content: null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    model,
  };
}

describe("OpenAIProvider", () => {
  describe("message conversion", () => {
    test("tool role maps to OpenAI tool message with tool_call_id", async () => {
      createResponse = makeTextResponse("ok");
      const provider = new OpenAIProvider("key", "gpt-4o");
      await provider.chat({
        messages: [
          { role: "user", content: "Hi" },
          { role: "tool", content: "result", toolCallId: "call_123" },
        ],
      });

      const args = capturedCreateArgs as { messages: Array<Record<string, unknown>> };
      const toolMsg = args.messages[1];
      expect(toolMsg.role).toBe("tool");
      expect(toolMsg.content).toBe("result");
      expect(toolMsg.tool_call_id).toBe("call_123");
    });

    test("assistant with toolCalls maps to OpenAI format", async () => {
      createResponse = makeTextResponse("ok");
      const provider = new OpenAIProvider("key", "gpt-4o");
      await provider.chat({
        messages: [
          { role: "user", content: "Hi" },
          {
            role: "assistant",
            content: null,
            toolCalls: [{
              id: "call_1",
              type: "function" as const,
              function: { name: "get_time", arguments: "{}" },
            }],
          },
        ],
      });

      const args = capturedCreateArgs as { messages: Array<Record<string, unknown>> };
      const assistantMsg = args.messages[1] as {
        role: string;
        tool_calls: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      };
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls[0].id).toBe("call_1");
      expect(assistantMsg.tool_calls[0].type).toBe("function");
      expect(assistantMsg.tool_calls[0].function.name).toBe("get_time");
    });

    test("standard roles pass through", async () => {
      createResponse = makeTextResponse("ok");
      const provider = new OpenAIProvider("key", "gpt-4o");
      await provider.chat({
        messages: [
          { role: "system", content: "Be helpful" },
          { role: "user", content: "Hello" },
        ],
      });

      const args = capturedCreateArgs as { messages: Array<{ role: string; content: string }> };
      expect(args.messages[0].role).toBe("system");
      expect(args.messages[0].content).toBe("Be helpful");
      expect(args.messages[1].role).toBe("user");
      expect(args.messages[1].content).toBe("Hello");
    });
  });

  describe("tool conversion", () => {
    test("converts LLMToolDefinition to OpenAI format", async () => {
      createResponse = makeTextResponse("ok");
      const provider = new OpenAIProvider("key", "gpt-4o");
      await provider.chat({
        messages: [{ role: "user", content: "Hi" }],
        tools: [{
          name: "search",
          description: "Search the web",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        }],
      });

      const args = capturedCreateArgs as {
        tools: Array<{ type: string; function: { name: string; description: string } }>;
      };
      expect(args.tools).toHaveLength(1);
      expect(args.tools[0].type).toBe("function");
      expect(args.tools[0].function.name).toBe("search");
      expect(args.tools[0].function.description).toBe("Search the web");
    });
  });

  describe("response parsing", () => {
    test("text response returns stop finishReason", async () => {
      createResponse = makeTextResponse("Hello there");
      const provider = new OpenAIProvider("key", "gpt-4o");
      const response = await provider.chat({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(response.message.role).toBe("assistant");
      expect(response.message.content).toBe("Hello there");
      expect(response.finishReason).toBe("stop");
      expect(response.usage.promptTokens).toBe(15);
      expect(response.usage.completionTokens).toBe(25);
    });

    test("tool call response returns tool_calls finishReason", async () => {
      createResponse = makeToolCallResponse([
        { id: "call_abc", name: "get_weather", arguments: '{"city":"NYC"}' },
      ]);
      const provider = new OpenAIProvider("key", "gpt-4o");
      const response = await provider.chat({
        messages: [{ role: "user", content: "Weather?" }],
      });

      expect(response.finishReason).toBe("tool_calls");
      expect(response.message.toolCalls).toHaveLength(1);
      const tc = response.message.toolCalls![0];
      expect(tc.id).toBe("call_abc");
      expect(tc.type).toBe("function");
      expect(tc.function.name).toBe("get_weather");
      expect(tc.function.arguments).toBe('{"city":"NYC"}');
    });

    test("filters non-function tool calls", async () => {
      createResponse = {
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: "1", type: "function", function: { name: "fn1", arguments: "{}" } },
              { id: "2", type: "other", function: { name: "fn2", arguments: "{}" } },
            ],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: "gpt-4o",
      };
      const provider = new OpenAIProvider("key", "gpt-4o");
      const response = await provider.chat({
        messages: [{ role: "user", content: "test" }],
      });

      expect(response.message.toolCalls).toHaveLength(1);
      expect(response.message.toolCalls![0].id).toBe("1");
    });
  });
});
