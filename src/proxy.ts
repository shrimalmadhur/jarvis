import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "jarvis_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

// Paths that don't require auth
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

/**
 * Verify session token using Web Crypto API (Edge-compatible).
 */
async function verifyToken(
  token: string,
  password: string
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestamp, signature] = parts;
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;

  // Check expiration
  const age = Math.floor(Date.now() / 1000) - ts;
  if (age > SESSION_MAX_AGE || age < 0) return false;

  // Verify HMAC using Web Crypto API (available in Edge runtime)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp));
  const expectedHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (signature.length !== expectedHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // If no JARVIS_PASSWORD is set, skip auth entirely
  const password = process.env.JARVIS_PASSWORD;
  if (!password) {
    return NextResponse.next();
  }

  // For API routes, allow bearer token auth via JARVIS_API_SECRET
  // (used by Claude Code hooks and cron scripts calling the API)
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const authHeader = request.headers.get("authorization");
    const apiSecret = process.env.JARVIS_API_SECRET;
    if (apiSecret && authHeader === `Bearer ${apiSecret}`) {
      return NextResponse.next();
    }
  }

  // Check session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return redirectToLogin(request);
  }

  // Verify token signature + expiry
  const valid = await verifyToken(token, password);
  if (!valid) {
    return redirectToLogin(request);
  }

  return NextResponse.next();
}

function redirectToLogin(request: NextRequest) {
  // For API routes, return 401 instead of redirect
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
