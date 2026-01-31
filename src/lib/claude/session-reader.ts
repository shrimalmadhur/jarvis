import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  ClaudeSessionEntry,
  AgentSession,
  AgentStatusResponse,
} from "./types";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const TAIL_BYTES = 16_384;
const ACTIVE_MS = 2 * 60 * 1000;
const IDLE_MS = 10 * 60 * 1000;
const COMPLETED_MS = 60 * 60 * 1000;

function getStatus(mtimeMs: number): "active" | "idle" | "completed" | null {
  const age = Date.now() - mtimeMs;
  if (age < ACTIVE_MS) return "active";
  if (age < IDLE_MS) return "idle";
  if (age < COMPLETED_MS) return "completed";
  return null;
}

function extractProjectName(cwdPath: string): {
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

function decodeProjectDir(dirName: string): string {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

function shortenModel(model: string): string {
  if (model.includes("opus-4-5")) return "Opus 4.5";
  if (model.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (model.includes("haiku-4-5")) return "Haiku 4.5";
  if (model.includes("opus-4")) return "Opus 4";
  if (model.includes("sonnet-4")) return "Sonnet 4";
  if (model.includes("haiku-4")) return "Haiku 4";
  if (model === "<synthetic>") return "synthetic";
  return model;
}

async function readTail(filePath: string): Promise<ClaudeSessionEntry[]> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const readSize = Math.min(TAIL_BYTES, stat.size);
    const offset = Math.max(0, stat.size - readSize);
    const buf = Buffer.alloc(readSize);
    await handle.read(buf, 0, readSize, offset);

    const text = buf.toString("utf-8");
    const startIdx = offset === 0 ? 0 : text.indexOf("\n") + 1;
    const lines = text.slice(startIdx).split("\n").filter(Boolean);

    const entries: ClaudeSessionEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } finally {
    await handle.close();
  }
}

function extractLastAction(entries: ClaudeSessionEntry[]): {
  lastAction: string | null;
  lastToolName: string | null;
} {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "assistant" || !entry.message?.content) continue;
    if (typeof entry.message.content === "string") continue;

    for (const block of entry.message.content) {
      if (block.type === "tool_use" && block.name) {
        let description = block.name;
        if (block.input) {
          if ("command" in block.input) {
            description = `${block.name}: ${String(block.input.command).slice(0, 80)}`;
          } else if ("file_path" in block.input) {
            description = `${block.name}: ${String(block.input.file_path)}`;
          } else if ("query" in block.input) {
            description = `${block.name}: ${String(block.input.query).slice(0, 80)}`;
          } else if ("pattern" in block.input) {
            description = `${block.name}: ${String(block.input.pattern)}`;
          } else if ("description" in block.input) {
            description = String(block.input.description).slice(0, 100);
          }
        }
        return { lastAction: description, lastToolName: block.name };
      }
      if (block.type === "text" && block.text && block.text.length > 10) {
        return {
          lastAction: block.text.replace(/\n/g, " ").slice(0, 120),
          lastToolName: null,
        };
      }
    }
  }

  const last = entries[entries.length - 1];
  if (last?.type === "user") {
    return { lastAction: "Waiting for input", lastToolName: null };
  }
  return { lastAction: null, lastToolName: null };
}

async function aggregateTokensFromFile(filePath: string) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let messageCount = 0;

  const content = await fs.readFile(filePath, "utf-8");
  for (const line of content.split("\n")) {
    if (!line) continue;
    // Fast check: skip lines without usage data
    if (!line.includes('"usage"')) {
      // Still count messages
      if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) {
        messageCount++;
      }
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (entry.message?.usage) {
        const u = entry.message.usage;
        inputTokens += u.input_tokens || 0;
        outputTokens += u.output_tokens || 0;
        cacheReadTokens += u.cache_read_input_tokens || 0;
        cacheCreationTokens += u.cache_creation_input_tokens || 0;
      }
      if (entry.type === "user" || entry.type === "assistant") {
        messageCount++;
      }
    } catch {
      // skip malformed lines
    }
  }
  return {
    tokenUsage: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
    messageCount,
  };
}

function extractMetadata(entries: ClaudeSessionEntry[]) {
  let slug: string | null = null;
  let model: string | null = null;
  let gitBranch: string | null = null;
  let cwd: string | null = null;

  // Walk backwards to get most recent values
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!slug && e.slug) slug = e.slug;
    if (!model && e.message?.model) model = e.message.model;
    if (!gitBranch && e.gitBranch) gitBranch = e.gitBranch;
    if (!cwd && e.cwd) cwd = e.cwd;
    if (slug && model && gitBranch && cwd) break;
  }
  return { slug, model, gitBranch, cwd };
}

async function readStatsCache(): Promise<{
  totalTokensToday: number;
  totalSessionsToday: number;
}> {
  try {
    const raw = await fs.readFile(
      path.join(CLAUDE_DIR, "stats-cache.json"),
      "utf-8"
    );
    const stats = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);

    let totalTokens = 0;
    if (stats.dailyModelTokens) {
      const todayEntry = stats.dailyModelTokens.find(
        (d: { date: string }) => d.date === today
      );
      if (todayEntry?.tokensByModel) {
        for (const count of Object.values(todayEntry.tokensByModel)) {
          totalTokens += (count as number) || 0;
        }
      }
    }

    let totalSessions = 0;
    if (stats.dailyActivity) {
      const todayActivity = stats.dailyActivity.find(
        (d: { date: string }) => d.date === today
      );
      totalSessions = todayActivity?.sessionCount ?? 0;
    }

    return { totalTokensToday: totalTokens, totalSessionsToday: totalSessions };
  } catch {
    return { totalTokensToday: 0, totalSessionsToday: 0 };
  }
}

export async function scanSessions(): Promise<AgentStatusResponse> {
  const sessions: AgentSession[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(PROJECTS_DIR);
  } catch {
    return {
      sessions: [],
      summary: {
        activeCount: 0,
        idleCount: 0,
        completedCount: 0,
        totalTokensToday: 0,
        totalSessionsToday: 0,
      },
      scannedAt: new Date().toISOString(),
    };
  }

  const scanPromises = projectDirs.map(async (projDir) => {
    const projPath = path.join(PROJECTS_DIR, projDir);
    try {
      const stat = await fs.stat(projPath);
      if (!stat.isDirectory()) return [];
    } catch {
      return [];
    }

    let files: string[];
    try {
      files = await fs.readdir(projPath);
    } catch {
      return [];
    }

    // Only look at session JSONL files (UUIDs), skip subagents dir
    const jsonlFiles = files.filter(
      (f) => f.endsWith(".jsonl") && !f.startsWith("agent-")
    );

    const fileResults = await Promise.allSettled(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projPath, file);
        const fileStat = await fs.stat(filePath);
        const status = getStatus(fileStat.mtimeMs);
        if (!status) return null;

        const entries = await readTail(filePath);
        if (entries.length === 0) return null;

        const sessionId = file.replace(".jsonl", "");
        const meta = extractMetadata(entries);
        const fallbackPath = decodeProjectDir(projDir);
        const cwdPath = meta.cwd || fallbackPath;
        const { projectName, workspaceName } = extractProjectName(cwdPath);
        const { lastAction, lastToolName } = extractLastAction(entries);
        const { tokenUsage, messageCount } = await aggregateTokensFromFile(filePath);

        const lastEntry = entries[entries.length - 1];

        return {
          sessionId,
          projectPath: cwdPath,
          projectName,
          projectDir: projDir,
          workspaceName,
          slug: meta.slug,
          model: meta.model ? shortenModel(meta.model) : null,
          gitBranch: meta.gitBranch,
          status,
          lastActivity: lastEntry?.timestamp || new Date(fileStat.mtimeMs).toISOString(),
          lastAction,
          lastToolName,
          tokenUsage,
          messageCount,
          isSubagent: false as boolean,
        } satisfies AgentSession;
      })
    );

    const results: AgentSession[] = [];
    for (const r of fileResults) {
      if (r.status === "fulfilled" && r.value) {
        results.push(r.value);
      }
    }
    return results;
  });

  const allResults = await Promise.allSettled(scanPromises);
  for (const result of allResults) {
    if (result.status === "fulfilled") {
      sessions.push(...result.value);
    }
  }

  // Sort: active first, then idle, then completed. Within each group, most recent first.
  const statusOrder = { active: 0, idle: 1, completed: 2 };
  sessions.sort((a, b) => {
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });

  const statsCache = await readStatsCache();

  // If stats cache is stale (no entry for today), sum tokens from live sessions
  const liveTokens = sessions.reduce((sum, s) => {
    const t = s.tokenUsage;
    return sum + t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens;
  }, 0);

  return {
    sessions,
    summary: {
      activeCount: sessions.filter((s) => s.status === "active").length,
      idleCount: sessions.filter((s) => s.status === "idle").length,
      completedCount: sessions.filter((s) => s.status === "completed").length,
      totalTokensToday: statsCache.totalTokensToday || liveTokens,
      totalSessionsToday: statsCache.totalSessionsToday || sessions.length,
    },
    scannedAt: new Date().toISOString(),
  };
}
