import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let _cachedCodexPath: string | null = null;

/**
 * Resolve the full path to the `codex` CLI binary.
 * Checks common install locations first (useful when PATH is limited,
 * e.g. systemd services or cron jobs), then falls back to `which`.
 */
export function resolveCodexPath(): string {
  if (_cachedCodexPath) return _cachedCodexPath;

  const candidates = [
    join(homedir(), ".local", "bin", "codex"),
    "/usr/local/bin/codex",
    "/usr/bin/codex",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      _cachedCodexPath = candidate;
      return candidate;
    }
  }

  try {
    const resolved = execSync("which codex", { encoding: "utf-8" }).trim();
    _cachedCodexPath = resolved;
    return resolved;
  } catch {
    _cachedCodexPath = "codex";
    return "codex";
  }
}
