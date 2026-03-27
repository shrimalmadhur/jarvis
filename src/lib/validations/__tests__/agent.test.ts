import { describe, test, expect } from "bun:test";
import { createAgentSchema, updateAgentSchema } from "../agent";

describe("createAgentSchema", () => {
  const validAgent = {
    name: "test-agent",
    soul: "You are a helpful assistant.",
    skill: "## Task\nDo something useful.",
    schedule: "0 9 * * *",
  };

  test("accepts valid agent with all required fields", () => {
    const result = createAgentSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  test("accepts valid agent with optional fields", () => {
    const result = createAgentSchema.safeParse({
      ...validAgent,
      timezone: "America/New_York",
      envVars: { MY_VAR: "value" },
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  describe("name validation", () => {
    test("rejects empty name", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, name: "" });
      expect(result.success).toBe(false);
    });

    test("accepts 1-char name", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, name: "a" });
      expect(result.success).toBe(true);
    });

    test("rejects name over 100 chars", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, name: "a".repeat(101) });
      expect(result.success).toBe(false);
    });

    test("accepts name at max 100 chars", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, name: "a".repeat(100) });
      expect(result.success).toBe(true);
    });

    test("accepts spaces, hyphens, underscores", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, name: "my test-agent_v2" });
      expect(result.success).toBe(true);
    });

    test("rejects special characters", () => {
      for (const name of ["agent;rm", "agent&test", "agent$(cmd)", "agent/path", "agent\nline"]) {
        const result = createAgentSchema.safeParse({ ...validAgent, name });
        expect(result.success).toBe(false);
      }
    });
  });

  describe("schedule validation", () => {
    test("accepts valid 5-field cron expressions", () => {
      for (const schedule of ["* * * * *", "0 9 * * *", "*/15 * * * *", "0 0 1 * *", "0 9 * * MON-FRI"]) {
        const result = createAgentSchema.safeParse({ ...validAgent, schedule });
        expect(result.success).toBe(true);
      }
    });

    test("rejects invalid cron expressions", () => {
      for (const schedule of ["", "not a cron", "* * *", "* * * * * *"]) {
        const result = createAgentSchema.safeParse({ ...validAgent, schedule });
        expect(result.success).toBe(false);
      }
    });

    test("rejects cron with embedded newlines", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, schedule: "0 9\n* * *" });
      expect(result.success).toBe(false);
    });
  });

  describe("soul and skill length boundaries", () => {
    test("rejects empty soul", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, soul: "" });
      expect(result.success).toBe(false);
    });

    test("accepts 1-char soul", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, soul: "x" });
      expect(result.success).toBe(true);
    });

    test("rejects soul over 50000 chars", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, soul: "x".repeat(50001) });
      expect(result.success).toBe(false);
    });

    test("accepts soul at exactly 50000 chars", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, soul: "x".repeat(50000) });
      expect(result.success).toBe(true);
    });

    test("rejects empty skill", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, skill: "" });
      expect(result.success).toBe(false);
    });

    test("rejects skill over 50000 chars", () => {
      const result = createAgentSchema.safeParse({ ...validAgent, skill: "x".repeat(50001) });
      expect(result.success).toBe(false);
    });
  });

  describe("envVars deny-list filtering", () => {
    test("filters out denied keys like PATH", () => {
      const result = createAgentSchema.parse({
        ...validAgent,
        envVars: { PATH: "/evil", MY_VAR: "safe" },
      });
      expect(result.envVars).toEqual({ MY_VAR: "safe" });
    });

    test("filters LD_PRELOAD, HOME, and other denied keys", () => {
      const result = createAgentSchema.parse({
        ...validAgent,
        envVars: {
          LD_PRELOAD: "lib.so",
          LD_LIBRARY_PATH: "/lib",
          HOME: "/root",
          NODE_OPTIONS: "--inspect",
          SHELL: "/bin/sh",
          SAFE_KEY: "ok",
        },
      });
      expect(result.envVars).toEqual({ SAFE_KEY: "ok" });
    });

    test("filtering is case-insensitive (uppercased before check)", () => {
      // Keys are uppercased before checking deny list
      const result = createAgentSchema.parse({
        ...validAgent,
        envVars: { path: "/evil", my_var: "safe" },
      });
      // "path" uppercased is "PATH" which is denied, but the key regex
      // requires alphanumeric+underscore which "path" matches
      // The deny list checks key.toUpperCase(), so lowercase "path" is filtered
      expect(result.envVars!.path).toBeUndefined();
    });
  });

  describe("envVars key validation", () => {
    test("accepts alphanumeric and underscore keys", () => {
      const result = createAgentSchema.parse({
        ...validAgent,
        envVars: { MY_VAR: "a", API_KEY_2: "b", _PRIVATE: "c" },
      });
      expect(Object.keys(result.envVars!)).toEqual(["MY_VAR", "API_KEY_2", "_PRIVATE"]);
    });

    test("rejects keys with special characters", () => {
      const result = createAgentSchema.parse({
        ...validAgent,
        envVars: { "MY-VAR": "a", "MY.VAR": "b", "MY VAR": "c", VALID: "d" },
      });
      expect(result.envVars).toEqual({ VALID: "d" });
    });

    test("trims whitespace from keys", () => {
      const result = createAgentSchema.parse({
        ...validAgent,
        envVars: { "  MY_VAR  ": "value" },
      });
      expect(result.envVars).toEqual({ MY_VAR: "value" });
    });

    test("skips empty keys after trimming", () => {
      const result = createAgentSchema.parse({
        ...validAgent,
        envVars: { "   ": "value", VALID: "ok" },
      });
      expect(result.envVars).toEqual({ VALID: "ok" });
    });
  });
});

describe("updateAgentSchema", () => {
  test("allows partial fields", () => {
    const result = updateAgentSchema.safeParse({ name: "new-name" });
    expect(result.success).toBe(true);
  });

  test("allows empty object", () => {
    const result = updateAgentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("still validates individual fields", () => {
    const result = updateAgentSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});
