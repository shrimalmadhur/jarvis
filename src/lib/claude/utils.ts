import path from "node:path";

/**
 * Shorten a Claude model identifier to a human-readable label.
 */
export function shortenModel(model: string): string {
  if (model.includes("opus-4-6")) return "Opus 4.6";
  if (model.includes("opus-4-5")) return "Opus 4.5";
  if (model.includes("sonnet-4-6")) return "Sonnet 4.6";
  if (model.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (model.includes("haiku-4-6")) return "Haiku 4.6";
  if (model.includes("haiku-4-5")) return "Haiku 4.5";
  if (model.includes("opus-4")) return "Opus 4";
  if (model.includes("sonnet-4")) return "Sonnet 4";
  if (model.includes("haiku-4")) return "Haiku 4";
  if (model === "<synthetic>") return "synthetic";
  return model;
}

/**
 * Extract a human-readable project name from a cwd path.
 */
export function extractProjectName(cwdPath: string): {
  projectName: string;
  workspaceName: string;
} {
  const conductorMatch = cwdPath.match(
    /conductor\/workspaces\/([^/]+)\/([^/]+)/
  );
  if (conductorMatch) {
    return {
      projectName: `${conductorMatch[1]}/${conductorMatch[2]}`,
      workspaceName: conductorMatch[2],
    };
  }
  const basename = path.basename(cwdPath);
  return { projectName: basename, workspaceName: basename };
}

/**
 * Decode a URL-safe project directory name back to its filesystem path.
 * Note: this is lossy — both `/` and `.` are encoded as `-`, so round-tripping is not possible.
 */
export function decodeProjectDir(dirName: string): string {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

/**
 * Encode a filesystem path to the ~/.claude/projects/ directory name format.
 * Claude CLI replaces both `/` and `.` with `-`.
 * Example: `/home/user/repo/.claude/worktrees/slug` → `-home-user-repo--claude-worktrees-slug`
 */
export function encodeProjectDir(fsPath: string): string {
  return fsPath.replace(/[/.]/g, "-");
}

/**
 * Parse JSONL content into typed objects, skipping malformed lines.
 */
export function parseJsonlEntries<T>(content: string): T[] {
  const entries: T[] = [];
  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}
