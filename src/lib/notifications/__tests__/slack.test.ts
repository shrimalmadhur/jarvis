import { describe, test, expect } from "bun:test";
import {
  maskSlackToken,
  isValidSlackBotToken,
  isValidSlackAppToken,
  SLACK_SAFE_MSG_LEN,
} from "../slack";

describe("maskSlackToken", () => {
  test("fully masks short tokens (<=8 chars)", () => {
    expect(maskSlackToken("abcd")).toBe("****");
    expect(maskSlackToken("12345678")).toBe("****");
  });

  test("shows first 4 and last 4 chars for longer tokens", () => {
    expect(maskSlackToken("xoxb-123456789")).toBe("xoxb****6789");
  });

  test("handles empty string", () => {
    expect(maskSlackToken("")).toBe("****");
  });
});

describe("isValidSlackBotToken", () => {
  test("accepts valid bot tokens", () => {
    expect(isValidSlackBotToken("xoxb-123-456-abc")).toBe(true);
    expect(isValidSlackBotToken("xoxb-1234567890-ABCDEF")).toBe(true);
  });

  test("rejects invalid bot tokens", () => {
    expect(isValidSlackBotToken("xapp-123-456")).toBe(false);
    expect(isValidSlackBotToken("")).toBe(false);
    expect(isValidSlackBotToken("random-string")).toBe(false);
  });
});

describe("isValidSlackAppToken", () => {
  test("accepts valid app tokens", () => {
    expect(isValidSlackAppToken("xapp-123-456-abc")).toBe(true);
  });

  test("rejects invalid app tokens", () => {
    expect(isValidSlackAppToken("xoxb-123-456")).toBe(false);
    expect(isValidSlackAppToken("")).toBe(false);
  });
});

describe("SLACK_SAFE_MSG_LEN", () => {
  test("is less than 40000 (Slack's hard limit)", () => {
    expect(SLACK_SAFE_MSG_LEN).toBeLessThan(40_000);
    expect(SLACK_SAFE_MSG_LEN).toBe(35_000);
  });
});
