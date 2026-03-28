import { ACTIVE_MS, IDLE_MS } from "./constants";
import type { ClaudeSessionEntry } from "./types";

/**
 * Determine session status based on file modification time.
 * Returns null for sessions older than completedMs (default 1 hour).
 */
export function getSessionStatus(
  mtimeMs: number,
  completedMs: number | null = 60 * 60 * 1000
): "active" | "idle" | "completed" | null {
  const age = Date.now() - mtimeMs;
  if (age < ACTIVE_MS) return "active";
  if (age < IDLE_MS) return "idle";
  if (completedMs === null || age < completedMs) return "completed";
  return null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Aggregate token usage from JSONL entries that have message.usage fields */
export function aggregateTokensFromEntries(entries: ClaudeSessionEntry[]): TokenUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (const e of entries) {
    if (e.message?.usage) {
      const u = e.message.usage;
      inputTokens += u.input_tokens || 0;
      outputTokens += u.output_tokens || 0;
      cacheReadTokens += u.cache_read_input_tokens || 0;
      cacheCreationTokens += u.cache_creation_input_tokens || 0;
    }
  }

  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
}

/** Extract first-found session metadata (slug, model, gitBranch, cwd) from entries. */
export function extractSessionMetadata(entries: ClaudeSessionEntry[]): {
  slug: string | null;
  model: string | null;
  gitBranch: string | null;
  cwd: string | null;
} {
  let slug: string | null = null;
  let model: string | null = null;
  let gitBranch: string | null = null;
  let cwd: string | null = null;

  for (const e of entries) {
    if (!slug && e.slug) slug = e.slug;
    if (!model && e.message?.model) model = e.message.model;
    if (!gitBranch && e.gitBranch) gitBranch = e.gitBranch;
    if (!cwd && e.cwd) cwd = e.cwd;
    if (slug && model && gitBranch && cwd) break;
  }

  return { slug, model, gitBranch, cwd };
}

/** Summarize a tool_use block's input for display in timelines and session lists. */
export function summarizeToolInput(name: string, input?: Record<string, unknown>): string {
  if (!input) return name;
  if ("command" in input) return `${name}: ${String(input.command).slice(0, 120)}`;
  if ("file_path" in input) return `${name}: ${String(input.file_path)}`;
  if ("query" in input) return `${name}: ${String(input.query).slice(0, 120)}`;
  if ("pattern" in input) return `${name}: ${String(input.pattern).slice(0, 80)}`;
  if ("prompt" in input) return `${name}: ${String(input.prompt).slice(0, 120)}`;
  if ("description" in input) return `${name}: ${String(input.description).slice(0, 120)}`;
  if ("url" in input) return `${name}: ${String(input.url).slice(0, 100)}`;
  if ("old_string" in input) return `${name}: replacing in ${input.file_path ?? "file"}`;
  return name;
}

/** Extract per-message token usage for timeline entries */
export function extractMessageUsage(
  entry: ClaudeSessionEntry
): TokenUsage | undefined {
  if (!entry.message?.usage) return undefined;
  const u = entry.message.usage;
  return {
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    cacheReadTokens: u.cache_read_input_tokens || 0,
    cacheCreationTokens: u.cache_creation_input_tokens || 0,
  };
}
