import { NextResponse } from "next/server";
import type { ZodSchema, infer as ZodInfer } from "zod";

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

/**
 * Parse a request body against a Zod schema.
 * Returns { data } on success, or { error: Response } on failure.
 */
export function parseBody<T extends ZodSchema>(
  body: unknown,
  schema: T
): { data: ZodInfer<T>; error?: never } | { data?: never; error: Response } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      error: NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      ),
    };
  }
  return { data: parsed.data };
}
