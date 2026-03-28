import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { withErrorHandler, parseBody } from "../utils";
import { NextResponse } from "next/server";

describe("parseBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  test("returns data on valid input", () => {
    const result = parseBody({ name: "test" }, schema);
    expect(result.data).toEqual({ name: "test" });
    expect(result.error).toBeUndefined();
  });

  test("returns 400 error response on invalid input", async () => {
    const result = parseBody({ name: "" }, schema);
    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(400);
  });
});

describe("withErrorHandler", () => {
  test("passes through successful responses", async () => {
    const handler = withErrorHandler(async () => {
      return NextResponse.json({ ok: true });
    });

    const request = new Request("http://localhost/api/test");
    const res = await handler(request, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  test("catches errors and returns 500", async () => {
    const handler = withErrorHandler(async () => {
      throw new Error("Something broke");
    });

    const request = new Request("http://localhost/api/test");
    const res = await handler(request, { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error" });
  });
});
