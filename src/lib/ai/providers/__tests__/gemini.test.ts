import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { LLMRequest } from "../../types";

// Capture args passed to generateContent
let capturedGenerateContentArgs: unknown = null;
let generateContentResponse: unknown = null;

const mockGenerateContent = mock(async (args: unknown) => {
  capturedGenerateContentArgs = args;
  return generateContentResponse;
});

const mockGetGenerativeModel = mock(() => ({
  generateContent: mockGenerateContent,
}));

mock.module("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = mockGetGenerativeModel;
  },
  SchemaType: {
    OBJECT: "OBJECT",
    STRING: "STRING",
    NUMBER: "NUMBER",
    BOOLEAN: "BOOLEAN",
    ARRAY: "ARRAY",
    INTEGER: "INTEGER",
  },
}));

// Import AFTER mock
const { GeminiProvider } = await import("../gemini");

beforeEach(() => {
  capturedGenerateContentArgs = null;
  mockGenerateContent.mockClear();
  mockGetGenerativeModel.mockClear();
});

function makeTextResponse(text: string, usage = { promptTokenCount: 10, candidatesTokenCount: 20 }) {
  return {
    response: {
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: usage,
    },
  };
}

function makeFunctionCallResponse(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
  usage = { promptTokenCount: 10, candidatesTokenCount: 5 }
) {
  return {
    response: {
      candidates: [{
        content: {
          parts: calls.map((c) => ({
            functionCall: { name: c.name, args: c.args },
          })),
        },
      }],
      usageMetadata: usage,
    },
  };
}

describe("GeminiProvider", () => {
  test("constructor uses provided model name", () => {
    new GeminiProvider("key", "gemini-3-flash");
    expect(mockGetGenerativeModel).not.toHaveBeenCalled(); // Only called on chat()
  });

  describe("message conversion", () => {
    test("system messages become systemInstruction", async () => {
      generateContentResponse = makeTextResponse("hi");
      const provider = new GeminiProvider("key", "test-model");
      await provider.chat({
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello" },
        ],
      });

      const args = capturedGenerateContentArgs as Record<string, unknown>;
      expect(args.systemInstruction).toBe("You are helpful.");
      const contents = args.contents as Array<{ role: string; parts: unknown[] }>;
      // System should not appear in contents
      expect(contents.every((c) => c.role !== "system")).toBe(true);
    });

    test("user messages become user role with text parts", async () => {
      generateContentResponse = makeTextResponse("hi");
      const provider = new GeminiProvider("key", "test-model");
      await provider.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      const args = capturedGenerateContentArgs as Record<string, unknown>;
      const contents = args.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
      expect(contents[0].role).toBe("user");
      expect(contents[0].parts[0].text).toBe("Hello");
    });

    test("assistant with _providerParts replays raw parts", async () => {
      generateContentResponse = makeTextResponse("response");
      const rawParts = [{ text: "thought" }, { functionCall: { name: "fn", args: {} } }];
      const provider = new GeminiProvider("key", "test-model");
      await provider.chat({
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: null, _providerParts: rawParts },
          { role: "user", content: "Continue" },
        ],
      });

      const args = capturedGenerateContentArgs as Record<string, unknown>;
      const contents = args.contents as Array<{ role: string; parts: unknown[] }>;
      const assistantMsg = contents[1];
      expect(assistantMsg.role).toBe("model");
      expect(assistantMsg.parts).toEqual(rawParts);
    });

    test("assistant with toolCalls reconstructs functionCall parts", async () => {
      generateContentResponse = makeTextResponse("done");
      const provider = new GeminiProvider("key", "test-model");
      await provider.chat({
        messages: [
          { role: "user", content: "Hi" },
          {
            role: "assistant",
            content: null,
            toolCalls: [{
              id: "call_1",
              type: "function" as const,
              function: { name: "get_time", arguments: '{"tz":"UTC"}' },
            }],
          },
          { role: "user", content: "Thanks" },
        ],
      });

      const args = capturedGenerateContentArgs as Record<string, unknown>;
      const contents = args.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      const assistantParts = contents[1].parts;
      expect(assistantParts[0].functionCall).toEqual({
        name: "get_time",
        args: { tz: "UTC" },
      });
    });

    test("tool role becomes function role with functionResponse", async () => {
      generateContentResponse = makeTextResponse("got it");
      const provider = new GeminiProvider("key", "test-model");
      await provider.chat({
        messages: [
          { role: "user", content: "Hi" },
          { role: "tool", content: "tool result", name: "get_time", toolCallId: "call_1" },
        ],
      });

      const args = capturedGenerateContentArgs as Record<string, unknown>;
      const contents = args.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      const toolMsg = contents[1];
      expect(toolMsg.role).toBe("function");
      const fr = toolMsg.parts[0].functionResponse as { name: string; response: { result: string } };
      expect(fr.name).toBe("get_time");
      expect(fr.response.result).toBe("tool result");
    });
  });

  describe("tool conversion", () => {
    test("converts LLMToolDefinition to Gemini format", async () => {
      generateContentResponse = makeTextResponse("ok");
      const provider = new GeminiProvider("key", "test-model");
      await provider.chat({
        messages: [{ role: "user", content: "Hi" }],
        tools: [{
          name: "get_weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        }],
      });

      const args = capturedGenerateContentArgs as Record<string, unknown>;
      const tools = args.tools as Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
      expect(tools).toHaveLength(1);
      const decl = tools[0].functionDeclarations[0];
      expect(decl.name).toBe("get_weather");
      expect(decl.description).toBe("Get weather");
    });
  });

  describe("response parsing", () => {
    test("text response returns stop finishReason", async () => {
      generateContentResponse = makeTextResponse("Hello world");
      const provider = new GeminiProvider("key", "test-model");
      const response = await provider.chat({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(response.message.role).toBe("assistant");
      expect(response.message.content).toBe("Hello world");
      expect(response.finishReason).toBe("stop");
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(20);
    });

    test("function call response returns tool_calls finishReason", async () => {
      generateContentResponse = makeFunctionCallResponse([
        { name: "get_time", args: { timezone: "UTC" } },
      ]);
      const provider = new GeminiProvider("key", "test-model");
      const response = await provider.chat({
        messages: [{ role: "user", content: "What time is it?" }],
      });

      expect(response.finishReason).toBe("tool_calls");
      expect(response.message.toolCalls).toHaveLength(1);
      const tc = response.message.toolCalls![0];
      expect(tc.function.name).toBe("get_time");
      expect(JSON.parse(tc.function.arguments)).toEqual({ timezone: "UTC" });
      expect(tc.id).toMatch(/^call_\d+_0$/);
    });

    test("preserves raw parts as _providerParts on function call response", async () => {
      generateContentResponse = makeFunctionCallResponse([
        { name: "fn", args: {} },
      ]);
      const provider = new GeminiProvider("key", "test-model");
      const response = await provider.chat({
        messages: [{ role: "user", content: "test" }],
      });

      expect(response.message._providerParts).toBeDefined();
      expect(Array.isArray(response.message._providerParts)).toBe(true);
    });
  });
});
