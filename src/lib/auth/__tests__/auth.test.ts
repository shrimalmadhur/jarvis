import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import crypto from "node:crypto";
import {
  isAuthEnabled,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  SESSION_MAX_AGE,
} from "../../auth";

let savedPassword: string | undefined;

beforeEach(() => {
  savedPassword = process.env.DOBBY_PASSWORD;
});

afterEach(() => {
  if (savedPassword !== undefined) {
    process.env.DOBBY_PASSWORD = savedPassword;
  } else {
    delete process.env.DOBBY_PASSWORD;
  }
});

describe("no-password mode (DOBBY_PASSWORD unset)", () => {
  beforeEach(() => {
    delete process.env.DOBBY_PASSWORD;
  });

  test("isAuthEnabled returns false", () => {
    expect(isAuthEnabled()).toBe(false);
  });

  test("verifyPassword returns true for any input", () => {
    expect(verifyPassword("anything")).toBe(true);
    expect(verifyPassword("")).toBe(true);
  });

  test("createSessionToken returns empty string", () => {
    expect(createSessionToken()).toBe("");
  });

  test("verifySessionToken returns true for any input", () => {
    expect(verifySessionToken("anything")).toBe(true);
    expect(verifySessionToken("")).toBe(true);
  });
});

describe("password mode (DOBBY_PASSWORD set)", () => {
  const TEST_PASSWORD = "test-secret-password-123";

  beforeEach(() => {
    process.env.DOBBY_PASSWORD = TEST_PASSWORD;
  });

  test("isAuthEnabled returns true", () => {
    expect(isAuthEnabled()).toBe(true);
  });

  test("verifyPassword returns true for correct password", () => {
    expect(verifyPassword(TEST_PASSWORD)).toBe(true);
  });

  test("verifyPassword returns false for wrong password", () => {
    expect(verifyPassword("wrong-password")).toBe(false);
  });

  test("verifyPassword returns false for empty string", () => {
    expect(verifyPassword("")).toBe(false);
  });

  test("verifyPassword returns false for different length", () => {
    expect(verifyPassword("short")).toBe(false);
    expect(verifyPassword(TEST_PASSWORD + "extra")).toBe(false);
  });

  test("createSessionToken returns non-empty token", () => {
    const token = createSessionToken();
    expect(token.length).toBeGreaterThan(0);
    expect(token).toContain(".");
  });

  test("createSessionToken format is timestamp.signature", () => {
    const token = createSessionToken();
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    const timestamp = parseInt(parts[0], 10);
    expect(timestamp).toBeGreaterThan(0);
    // Signature is a hex string
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
  });

  test("verifySessionToken validates token from createSessionToken", () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
  });

  test("verifySessionToken rejects tampered signature", () => {
    const token = createSessionToken();
    const parts = token.split(".");
    const tampered = parts[0] + ".0000000000000000000000000000000000000000000000000000000000000000";
    expect(verifySessionToken(tampered)).toBe(false);
  });

  test("verifySessionToken rejects garbage token", () => {
    expect(verifySessionToken("garbage")).toBe(false);
    expect(verifySessionToken("not.a.valid.token")).toBe(false);
    expect(verifySessionToken("")).toBe(false);
  });

  test("verifySessionToken rejects expired token", () => {
    // Craft a backdated token manually
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - SESSION_MAX_AGE - 100).toString();
    const signature = crypto
      .createHmac("sha256", TEST_PASSWORD)
      .update(expiredTimestamp)
      .digest("hex");
    const expiredToken = `${expiredTimestamp}.${signature}`;
    expect(verifySessionToken(expiredToken)).toBe(false);
  });

  test("SESSION_MAX_AGE is 30 days in seconds", () => {
    expect(SESSION_MAX_AGE).toBe(30 * 24 * 60 * 60);
  });
});
