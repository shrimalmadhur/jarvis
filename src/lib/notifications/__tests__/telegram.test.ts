import { describe, test, expect } from "bun:test";
import {
  maskToken,
  escapeHtml,
  markdownToTelegramHtml,
  TELEGRAM_MAX_MSG_LEN,
  TELEGRAM_SAFE_MSG_LEN,
} from "../telegram";

describe("maskToken", () => {
  test("fully masks short tokens (<=8 chars)", () => {
    expect(maskToken("abcd")).toBe("****");
    expect(maskToken("12345678")).toBe("****");
  });

  test("shows first 4 and last 4 chars for longer tokens", () => {
    expect(maskToken("123456789")).toBe("1234****6789");
    expect(maskToken("abcdefghijklmnop")).toBe("abcd****mnop");
  });

  test("handles empty string", () => {
    expect(maskToken("")).toBe("****");
  });
});

describe("escapeHtml", () => {
  test("escapes &", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes <", () => {
    expect(escapeHtml("<tag>")).toBe("&lt;tag&gt;");
  });

  test("escapes >", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  test("does NOT escape quotes (only &, <, >)", () => {
    expect(escapeHtml('"hello"')).toBe('"hello"');
  });

  test("escapes multiple characters", () => {
    expect(escapeHtml("<b>test</b> & more")).toBe("&lt;b&gt;test&lt;/b&gt; &amp; more");
  });

  test("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("markdownToTelegramHtml", () => {
  test("converts **bold** to <b>", () => {
    expect(markdownToTelegramHtml("**bold text**")).toBe("<b>bold text</b>");
  });

  test("converts __bold__ to <b>", () => {
    expect(markdownToTelegramHtml("__bold text__")).toBe("<b>bold text</b>");
  });

  test("converts *italic* to <i>", () => {
    expect(markdownToTelegramHtml("*italic text*")).toBe("<i>italic text</i>");
  });

  test("converts ~~strikethrough~~ to <s>", () => {
    expect(markdownToTelegramHtml("~~deleted~~")).toBe("<s>deleted</s>");
  });

  test("converts inline `code` to <code>", () => {
    expect(markdownToTelegramHtml("`code here`")).toBe("<code>code here</code>");
  });

  test("converts code blocks to <pre>", () => {
    const input = "```\nconst x = 1;\n```";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("<pre>");
    expect(result).toContain("const x = 1;");
    expect(result).toContain("</pre>");
  });

  test("converts code blocks with language tag", () => {
    const input = "```typescript\nconst x = 1;\n```";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("<pre>");
    expect(result).toContain("const x = 1;");
  });

  test("converts links to <a>", () => {
    expect(markdownToTelegramHtml("[click](https://example.com)")).toBe(
      '<a href="https://example.com">click</a>'
    );
  });

  test("converts headers to bold", () => {
    expect(markdownToTelegramHtml("## Title")).toBe("<b>Title</b>");
    expect(markdownToTelegramHtml("# Big Title")).toBe("<b>Big Title</b>");
    expect(markdownToTelegramHtml("### Sub")).toBe("<b>Sub</b>");
  });

  test("converts bullet lists", () => {
    const input = "- item 1\n- item 2\n* item 3";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("\u2022 item 1");
    expect(result).toContain("\u2022 item 2");
    expect(result).toContain("\u2022 item 3");
  });

  test("collapses 3+ newlines to 2", () => {
    const input = "first\n\n\n\nsecond";
    const result = markdownToTelegramHtml(input);
    expect(result).toBe("first\n\nsecond");
  });

  test("HTML entities in code blocks are escaped within the placeholder", () => {
    const input = "`<div>&</div>`";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("&lt;div&gt;&amp;&lt;/div&gt;");
  });

  test("HTML entities outside code are also escaped", () => {
    const input = "use <b> tag & more";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&amp;");
  });
});

describe("constants", () => {
  test("TELEGRAM_MAX_MSG_LEN is 4096", () => {
    expect(TELEGRAM_MAX_MSG_LEN).toBe(4096);
  });

  test("TELEGRAM_SAFE_MSG_LEN is 3800", () => {
    expect(TELEGRAM_SAFE_MSG_LEN).toBe(3800);
  });
});
