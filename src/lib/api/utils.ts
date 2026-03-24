import { NextResponse } from "next/server";

type RouteContext = { params: Promise<Record<string, string>> };

type RouteHandler = (
  request: Request,
  context: RouteContext
) => Promise<Response>;

/**
 * Wraps an API route handler with standardized error handling.
 * Catches unhandled errors, logs with the route URL for debugging, and returns a generic 500.
 *
 * Category B (streaming) and Category C (stateful/complex) routes are excluded - see plan.
 */
export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (request: Request, context: RouteContext) => {
    try {
      return await handler(request, context);
    } catch (error) {
      const url = new URL(request.url).pathname;
      console.error(`API error [${request.method} ${url}]:`, error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

/** Shorthand for JSON responses */
export function jsonResponse<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** 404 response */
export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** 409 conflict response */
export function conflict(message = "Already exists") {
  return NextResponse.json({ error: message }, { status: 409 });
}

/** 400 bad request response */
export function badRequest(message = "Bad request") {
  return NextResponse.json({ error: message }, { status: 400 });
}
