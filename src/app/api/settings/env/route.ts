import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, renameSync, lstatSync } from "fs";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

const ENV_FILE = "/etc/dobby/env";
const MAX_VALUE_LENGTH = 1024;
const MAX_KEY_LENGTH = 128;

// Allowlist of keys editable from the UI — safe config keys only
const ALLOWED_KEYS = new Set([
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
]);

// Valid env key format: uppercase letters, digits, underscores, starts with letter
const VALID_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

// Sentinel value to signal key deletion
const DELETE_SENTINEL = "__DELETE__";

function quoteValue(value: string): string {
  // Double-quote encoding — easy to parse back symmetrically
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    // Handle shell single-quote escaping: 'it'\''s' → it's
    const inner = value.slice(1, -1);
    return inner.replace(/'\\''/, "'");
  }
  return value;
}

function isAllowedKey(key: string): boolean {
  return ALLOWED_KEYS.has(key);
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function parseEnvFile(): Record<string, string> {
  if (!isRegularFile(ENV_FILE)) return {};

  const content = readFileSync(ENV_FILE, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const rawValue = trimmed.slice(eqIdx + 1).trim();
    if (isAllowedKey(key)) {
      result[key] = unquote(rawValue);
    }
  }

  return result;
}

function updateEnvFile(updates: Record<string, string>): void {
  const content = readFileSync(ENV_FILE, "utf-8");
  const lines = content.split("\n");
  const handledKeys = new Set<string>();

  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      // Only uncomment exact `# KEY=` patterns (no spaces around =)
      const commentMatch = trimmed.match(/^#\s*([A-Z][A-Z0-9_]*)=(.*)$/);
      if (commentMatch && commentMatch[1] in updates && isAllowedKey(commentMatch[1])) {
        const key = commentMatch[1];
        if (!handledKeys.has(key)) {
          handledKeys.add(key);
          if (updates[key] !== DELETE_SENTINEL) {
            newLines.push(`${key}=${quoteValue(updates[key])}`);
          }
          // If deleting, just drop the commented line too
        }
        continue;
      }
      newLines.push(line);
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      newLines.push(line);
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();

    if (key in updates && isAllowedKey(key)) {
      if (!handledKeys.has(key)) {
        handledKeys.add(key);
        if (updates[key] !== DELETE_SENTINEL) {
          newLines.push(`${key}=${quoteValue(updates[key])}`);
        }
        // If deleting, skip the line entirely
      }
      continue;
    }

    newLines.push(line);
  }

  // Append any new keys that weren't already in the file
  for (const [key, value] of Object.entries(updates)) {
    if (!handledKeys.has(key) && isAllowedKey(key) && value !== DELETE_SENTINEL) {
      newLines.push(`${key}=${quoteValue(value)}`);
    }
  }

  let output = newLines.join("\n");
  if (!output.endsWith("\n")) output += "\n";

  const tmpFile = ENV_FILE + ".tmp";
  writeFileSync(tmpFile, output, { mode: 0o600 });
  renameSync(tmpFile, ENV_FILE);
}

export const GET = withErrorHandler(async (request: Request) => {
  if (!isRegularFile(ENV_FILE)) {
    return NextResponse.json({ exists: false, keys: {} });
  }
  const keys = parseEnvFile();

  const url = new URL(request.url);
  const unmaskKey = url.searchParams.get("unmask");

  const result: Record<string, { set: boolean; masked: string; value?: string }> = {};
  for (const key of ALLOWED_KEYS) {
    const value = keys[key] || "";
    result[key] = {
      set: value.length > 0,
      masked: value.length > 0 ? "********" : "",
    };
    if (unmaskKey === key && value.length > 0) {
      result[key].value = value;
    }
  }
  return NextResponse.json({ exists: true, keys: result });
});

export const PATCH = withErrorHandler(async (request: Request) => {
  if (!isRegularFile(ENV_FILE)) {
    return NextResponse.json({ error: "Configuration file not found" }, { status: 404 });
  }

  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!VALID_KEY_RE.test(key)) {
      return NextResponse.json({ error: `"${key}" is not a valid env variable name (use UPPER_SNAKE_CASE)` }, { status: 400 });
    }
    if (key.length > MAX_KEY_LENGTH) {
      return NextResponse.json({ error: `Key "${key}" exceeds maximum length` }, { status: 400 });
    }
    if (typeof value !== "string") {
      return NextResponse.json({ error: `Value for "${key}" must be a string` }, { status: 400 });
    }
    // Allow DELETE_SENTINEL or empty string for deletion
    if (value === DELETE_SENTINEL || value === "") {
      // For allowed keys, treat as deletion
      if (!isAllowedKey(key)) {
        // Auto-add to allowlist for custom keys so they can be deleted
        ALLOWED_KEYS.add(key);
      }
      updates[key] = DELETE_SENTINEL;
      continue;
    }
    if (value.length > MAX_VALUE_LENGTH) {
      return NextResponse.json({ error: `Value for "${key}" exceeds maximum length` }, { status: 400 });
    }
    if (/[\n\r\0]/.test(value)) {
      return NextResponse.json({ error: `Value for "${key}" contains invalid characters` }, { status: 400 });
    }
    // Auto-add custom keys to the allowlist
    ALLOWED_KEYS.add(key);
    updates[key] = value;
  }

  updateEnvFile(updates);

  return NextResponse.json({ success: true, message: "Env file updated. Restart Dobby to apply changes." });
});
