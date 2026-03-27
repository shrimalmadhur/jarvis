import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock the providers to avoid real SDK instantiation
mock.module("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: async () => ({}) }; }
  },
  SchemaType: { OBJECT: "OBJECT" },
}));

mock.module("openai", () => ({
  default: class {
    chat = { completions: { create: async () => ({}) } };
  },
}));

mock.module("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: async () => ({}) };
  },
}));

const mockFindFirst = mock(async () => null as unknown);

mock.module("@/lib/db", () => ({
  db: { query: { llmConfigs: { findFirst: mockFindFirst } } },
  llmConfigs: { taskType: "taskType", isDefault: "isDefault" },
}));

const { resolveConfig, getLLMProvider } = await import("../router");

beforeEach(() => {
  mockFindFirst.mockReset();
  mockFindFirst.mockImplementation(async () => null);
});

describe("resolveConfig", () => {
  test("returns task-specific config from DB when found", async () => {
    mockFindFirst.mockImplementationOnce(async () => ({
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.5,
    }));

    const config = await resolveConfig("chat");
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.temperature).toBe(0.5);
  });

  test("falls back to isDefault config when task-specific not found", async () => {
    // First call (task-specific): returns null
    mockFindFirst.mockImplementationOnce(async () => null);
    // Second call (isDefault): returns a config
    mockFindFirst.mockImplementationOnce(async () => ({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      temperature: 0.8,
    }));

    const config = await resolveConfig("chat");
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-20250514");
  });

  test("falls back to hardcoded default when both DB queries return null", async () => {
    mockFindFirst.mockImplementation(async () => null);

    const config = await resolveConfig("chat");
    expect(config.provider).toBe("gemini");
    expect(config.model).toBe("gemini-3-flash-preview");
    expect(config.temperature).toBe(0.7);
  });

  test("does not query for isDefault when taskType is 'default'", async () => {
    mockFindFirst.mockImplementation(async () => null);

    const config = await resolveConfig("default");
    // Should only call findFirst once (for task-specific "default")
    // Since it returns null and taskType === "default", skip the isDefault query
    expect(config.provider).toBe("gemini");
    expect(config.model).toBe("gemini-3-flash-preview");
  });

  test("uses default temperature 0.7 when DB config has null temperature", async () => {
    mockFindFirst.mockImplementationOnce(async () => ({
      provider: "openai",
      model: "gpt-4o",
      temperature: null,
    }));

    const config = await resolveConfig("chat");
    expect(config.temperature).toBe(0.7);
  });
});

describe("getLLMProvider", () => {
  test("returns provider and config object", async () => {
    mockFindFirst.mockImplementation(async () => null);

    const result = await getLLMProvider();
    expect(result.provider).toBeDefined();
    expect(result.config).toBeDefined();
    expect(result.config.provider).toBe("gemini");
  });

  test("caches providers by provider:model key", async () => {
    mockFindFirst.mockImplementation(async () => null);

    const result1 = await getLLMProvider();
    const result2 = await getLLMProvider();
    // Same provider instance should be returned (cached)
    expect(result1.provider).toBe(result2.provider);
  });
});
