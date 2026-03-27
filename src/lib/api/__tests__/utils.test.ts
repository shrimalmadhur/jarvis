import { describe, test, expect } from "bun:test";
import { withErrorHandler, jsonResponse, notFound, conflict, badRequest } from "../utils";

describe("jsonResponse", () => {
  test("returns Response with JSON data and default 200 status", async () => {
    const res = jsonResponse({ message: "ok" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "ok" });
  });

  test("accepts custom status code", async () => {
    const res = jsonResponse({ created: true }, 201);
    expect(res.status).toBe(201);
  });
});

describe("notFound", () => {
  test("returns 404 with default message", async () => {
    const res = notFound();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });

  test("returns 404 with custom message", async () => {
    const res = notFound("Agent not found");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Agent not found" });
  });
});

describe("conflict", () => {
  test("returns 409 with default message", async () => {
    const res = conflict();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "Already exists" });
  });

  test("returns 409 with custom message", async () => {
    const res = conflict("Name taken");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "Name taken" });
  });
});

describe("badRequest", () => {
  test("returns 400 with default message", async () => {
    const res = badRequest();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Bad request" });
  });

  test("returns 400 with custom message", async () => {
    const res = badRequest("Invalid input");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid input" });
  });
});

describe("withErrorHandler", () => {
  test("passes through successful responses", async () => {
    const handler = withErrorHandler(async () => {
      return jsonResponse({ ok: true });
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
