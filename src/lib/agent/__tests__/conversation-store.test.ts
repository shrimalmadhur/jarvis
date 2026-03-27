import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks ---

// Read path mocks (relational query API)
const mockConvFindFirst = mock(async () => null as unknown);
const mockMsgFindMany = mock(async () => [] as unknown[]);

// Write path mocks (builder API)
const mockInsertReturning = mock(async () => [{ id: "conv-1", title: null }] as unknown[]);
const mockInsertValues = mock(() => ({ returning: mockInsertReturning }));
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateWhere = mock(async () => {});
const mockUpdateSet = mock(() => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

mock.module("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ field: a, value: b }),
  desc: (col: unknown) => ({ desc: col }),
}));

mock.module("@/lib/db", () => ({
  db: {
    query: {
      conversations: { findFirst: mockConvFindFirst, findMany: mock(async () => []) },
      messages: { findMany: mockMsgFindMany },
    },
    insert: mockInsert,
    update: mockUpdate,
  },
  conversations: { id: "id", updatedAt: "updatedAt" },
  messages: { conversationId: "conversationId", createdAt: "createdAt" },
}));

const {
  getConversation,
  createConversation,
  addMessage,
  updateConversationTitle,
} = await import("../conversation-store");

beforeEach(() => {
  mockConvFindFirst.mockReset();
  mockMsgFindMany.mockReset();
  mockInsert.mockClear();
  mockInsertValues.mockClear();
  mockInsertReturning.mockClear();
  mockUpdate.mockClear();
  mockUpdateSet.mockClear();
  mockUpdateWhere.mockClear();
  // Reset default implementations
  mockConvFindFirst.mockImplementation(async () => null);
  mockMsgFindMany.mockImplementation(async () => []);
  mockInsertReturning.mockImplementation(async () => [{ id: "conv-1", title: null }]);
});

describe("getConversation", () => {
  test("returns null when conversation not found", async () => {
    mockConvFindFirst.mockImplementation(async () => null);
    const result = await getConversation("nonexistent");
    expect(result).toBeNull();
  });

  test("converts user message DB row to LLMMessage", async () => {
    mockConvFindFirst.mockImplementation(async () => ({ id: "conv-1", title: "Test" }));
    mockMsgFindMany.mockImplementation(async () => [
      { role: "user", content: "Hello", toolCalls: null, toolCallId: null, providerData: null },
    ]);

    const result = await getConversation("conv-1");
    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0].role).toBe("user");
    expect(result!.messages[0].content).toBe("Hello");
  });

  test("converts assistant message DB row", async () => {
    mockConvFindFirst.mockImplementation(async () => ({ id: "conv-1", title: "Test" }));
    mockMsgFindMany.mockImplementation(async () => [
      { role: "assistant", content: "Hi there!", toolCalls: null, toolCallId: null, providerData: null },
    ]);

    const result = await getConversation("conv-1");
    expect(result!.messages[0].role).toBe("assistant");
    expect(result!.messages[0].content).toBe("Hi there!");
  });

  test("parses JSON toolCalls from DB into LLMToolCall format", async () => {
    mockConvFindFirst.mockImplementation(async () => ({ id: "conv-1", title: "Test" }));
    mockMsgFindMany.mockImplementation(async () => [
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "call_1", name: "get_time", arguments: '{"tz":"UTC"}' },
        ],
        toolCallId: null,
        providerData: null,
      },
    ]);

    const result = await getConversation("conv-1");
    const msg = result!.messages[0];
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].id).toBe("call_1");
    expect(msg.toolCalls![0].type).toBe("function");
    expect(msg.toolCalls![0].function.name).toBe("get_time");
    expect(msg.toolCalls![0].function.arguments).toBe('{"tz":"UTC"}');
  });

  test("converts tool result message with toolCallId", async () => {
    mockConvFindFirst.mockImplementation(async () => ({ id: "conv-1", title: "Test" }));
    mockMsgFindMany.mockImplementation(async () => [
      { role: "tool", content: "result data", toolCalls: null, toolCallId: "call_1", providerData: null },
    ]);

    const result = await getConversation("conv-1");
    const msg = result!.messages[0];
    expect(msg.role).toBe("tool");
    expect(msg.content).toBe("result data");
    expect(msg.toolCallId).toBe("call_1");
  });

  test("populates _providerParts from providerData", async () => {
    const rawParts = [{ text: "thought" }, { functionCall: { name: "fn", args: {} } }];
    mockConvFindFirst.mockImplementation(async () => ({ id: "conv-1", title: "Test" }));
    mockMsgFindMany.mockImplementation(async () => [
      { role: "assistant", content: null, toolCalls: null, toolCallId: null, providerData: rawParts },
    ]);

    const result = await getConversation("conv-1");
    expect(result!.messages[0]._providerParts).toEqual(rawParts);
  });
});

describe("addMessage", () => {
  test("inserts message with correct field mapping", async () => {
    await addMessage("conv-1", {
      role: "assistant",
      content: "response",
      toolCalls: [{
        id: "call_1",
        type: "function" as const,
        function: { name: "get_time", arguments: '{"tz":"UTC"}' },
      }],
    });

    expect(mockInsert).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalled();

    // Check the values passed to insert
    const valuesArg = (mockInsertValues.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect(valuesArg.conversationId).toBe("conv-1");
    expect(valuesArg.role).toBe("assistant");
    expect(valuesArg.content).toBe("response");
    // toolCalls should be serialized: function.name→name, function.arguments→arguments
    const tc = (valuesArg.toolCalls as Array<Record<string, unknown>>)[0];
    expect(tc.id).toBe("call_1");
    expect(tc.name).toBe("get_time");
    expect(tc.arguments).toBe('{"tz":"UTC"}');
  });

  test("stores _providerParts as providerData", async () => {
    const rawParts = [{ text: "raw" }];
    await addMessage("conv-1", {
      role: "assistant",
      content: null,
      _providerParts: rawParts,
    });

    const valuesArg = (mockInsertValues.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect(valuesArg.providerData).toEqual(rawParts);
  });

  test("uses null fallback for optional fields", async () => {
    await addMessage("conv-1", { role: "user", content: "hi" });

    const valuesArg = (mockInsertValues.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect(valuesArg.toolCalls).toBeNull();
    expect(valuesArg.toolCallId).toBeNull();
    expect(valuesArg.providerData).toBeNull();
    expect(valuesArg.modelUsed).toBeNull();
  });

  test("stores modelUsed when provided", async () => {
    await addMessage("conv-1", { role: "user", content: "hi" }, "gpt-4o");

    const valuesArg = (mockInsertValues.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect(valuesArg.modelUsed).toBe("gpt-4o");
  });

  test("updates conversation timestamp after insert", async () => {
    await addMessage("conv-1", { role: "user", content: "hi" });

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalled();
    const setArg = (mockUpdateSet.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect(setArg.updatedAt).toBeInstanceOf(Date);
  });
});

describe("createConversation", () => {
  test("returns id and title", async () => {
    mockInsertReturning.mockImplementation(async () => [{ id: "new-conv", title: "My Chat" }]);
    const result = await createConversation("My Chat");
    expect(result.id).toBe("new-conv");
    expect(result.title).toBe("My Chat");
  });
});
