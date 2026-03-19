import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, renameSync, existsSync, lstatSync } from "fs";

const ENV_FILE = "/etc/dobby/env";
const MAX_VALUE_LENGTH = 1024;

// Keys we allow reading/editing from the UI (no passwords/secrets — those require manual editing)
const EDITABLE_KEYS = [
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
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
    if (EDITABLE_KEYS.includes(key)) {
      result[key] = unquote(rawValue);
    }
  }

  return result;
}

function updateEnvFile(updates: Record<string, string>): void {
  const content = readFileSync(ENV_FILE, "utf-8");
  const lines = content.split("\n");
  const updatedKeys = new Set<string>();

  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      // Check if this is a commented-out key we want to uncomment
      const commentMatch = trimmed.match(/^#\s*([A-Z_]+)\s*=/);
      if (commentMatch && commentMatch[1] in updates && EDITABLE_KEYS.includes(commentMatch[1])) {
        const key = commentMatch[1];
        if (!updatedKeys.has(key)) {
          updatedKeys.add(key);
          newLines.push(`${key}=${shellQuote(updates[key])}`);
        }
        // Skip duplicate commented lines for same key
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

    if (key in updates && EDITABLE_KEYS.includes(key)) {
      if (!updatedKeys.has(key)) {
        updatedKeys.add(key);
        newLines.push(`${key}=${shellQuote(updates[key])}`);
      }
      // Skip duplicate lines for same key
      continue;
    }

    newLines.push(line);
  }

  // Append any keys that weren't already in the file
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key) && EDITABLE_KEYS.includes(key)) {
      newLines.push(`${key}=${shellQuote(value)}`);
    }
  }

  let output = newLines.join("\n");
  if (!output.endsWith("\n")) output += "\n";

  // Atomic write: write to temp file, then rename
  const tmpFile = ENV_FILE + ".tmp";
  writeFileSync(tmpFile, output);
  renameSync(tmpFile, ENV_FILE);
}

export async function GET() {
  try {
    if (!isRegularFile(ENV_FILE)) {
      return NextResponse.json({ exists: false, keys: {} });
    }
    const keys = parseEnvFile();
    const masked: Record<string, { set: boolean }> = {};
    for (const key of EDITABLE_KEYS) {
      const value = keys[key] || "";
      masked[key] = { set: value.length > 0 };
    }
    return NextResponse.json({ exists: true, keys: masked });
  } catch (error) {
    console.error("Error reading env file:", error);
    return NextResponse.json({ error: "Failed to read configuration" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isRegularFile(ENV_FILE)) {
      return NextResponse.json({ error: "Configuration file not found" }, { status: 404 });
    }

    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!EDITABLE_KEYS.includes(key)) {
        return NextResponse.json({ error: `Key "${key}" is not editable` }, { status: 400 });
      }
      if (typeof value !== "string") {
        return NextResponse.json({ error: `Value for "${key}" must be a string` }, { status: 400 });
      }
      if (value.length > MAX_VALUE_LENGTH) {
        return NextResponse.json({ error: `Value for "${key}" exceeds maximum length` }, { status: 400 });
      }
      if (/[\n\r\0]/.test(value)) {
        return NextResponse.json({ error: `Value for "${key}" contains invalid characters` }, { status: 400 });
      }
      updates[key] = value;
    }

    updateEnvFile(updates);

    return NextResponse.json({ success: true, message: "Env file updated. Restart Dobby to apply changes." });
  } catch (error) {
    console.error("Error updating env file:", error);
    return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
  }
}
