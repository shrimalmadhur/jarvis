import { NextResponse } from "next/server";
import {
  verifyPassword,
  createSessionToken,
  isAuthEnabled,
  COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/auth";

// Simple in-memory rate limiter: max 5 failed attempts per IP per 15 minutes
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now > entry.resetAt) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
  }
}

function clearFailures(ip: string): void {
  failedAttempts.delete(ip);
}

export async function POST(request: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 400 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { password } = body;

  if (!password || !verifyPassword(password)) {
    recordFailure(ip);
    // Constant delay to prevent timing-based user enumeration
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  clearFailures(ip);

  const token = createSessionToken();
  const response = NextResponse.json({ success: true });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return response;
}
