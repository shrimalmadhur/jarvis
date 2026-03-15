import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let _cachedClaudePath: string | null = null;

/**
 * Resolve the full path to the `claude` CLI binary.
 * Checks common install locations first (useful when PATH is limited,
 * e.g. systemd services or cron jobs), then falls back to `which`.
 */
export function resolveClaudePath(): string {
  if (_cachedClaudePath) return _cachedClaudePath;

  const candidates = [
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      _cachedClaudePath = candidate;
      return candidate;
    }
  }

  try {
    const resolved = execSync("which claude", { encoding: "utf-8" }).trim();
    _cachedClaudePath = resolved;
    return resolved;
  } catch {
    return "claude";
  }
}
