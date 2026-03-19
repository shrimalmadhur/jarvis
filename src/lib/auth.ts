import crypto from "node:crypto";

const COOKIE_NAME = "dobby_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

function getPassword(): string | null {
  return process.env.DOBBY_PASSWORD || null;
}

/**
 * Check if auth is enabled (password is set).
 */
export function isAuthEnabled(): boolean {
  return !!getPassword();
}

/**
 * Verify a password against the configured one.
 */
export function verifyPassword(input: string): boolean {
  const password = getPassword();
  if (!password) return true; // no password = no auth
  // Constant-time comparison
  return (
    input.length === password.length &&
    crypto.timingSafeEqual(Buffer.from(input), Buffer.from(password))
  );
}

/**
 * Create a signed session token.
 * Format: timestamp.signature
 */
export function createSessionToken(): string {
  const password = getPassword();
  if (!password) return "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac("sha256", password)
    .update(timestamp)
    .digest("hex");
  return `${timestamp}.${signature}`;
}

/**
 * Verify a session token is valid and not expired.
 */
export function verifySessionToken(token: string): boolean {
  const password = getPassword();
  if (!password) return true; // no auth configured

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestamp, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", password)
    .update(timestamp)
    .digest("hex");

  // Constant-time comparison for signature
  if (
    signature.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
  ) {
    return false;
  }

  // Check expiration
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  return age >= 0 && age < SESSION_MAX_AGE;
}

export { COOKIE_NAME, SESSION_MAX_AGE };
