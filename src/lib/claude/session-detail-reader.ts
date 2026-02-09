import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  ClaudeSessionEntry,
  SessionDetailResponse,
  TimelineEntry,
  SubAgentInfo,
  TaskInfo,
} from "./types";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const TASKS_DIR = path.join(CLAUDE_DIR, "tasks");

const ACTIVE_MS = 2 * 60 * 1000;
const IDLE_MS = 10 * 60 * 1000;

function getStatus(mtimeMs: number): "active" | "idle" | "completed" {
  const age = Date.now() - mtimeMs;
  if (age < ACTIVE_MS) return "active";
  if (age < IDLE_MS) return "idle";
  return "completed";
}

function shortenModel(model: string): string {
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

function extractProjectName(cwdPath: string): string {
  const m = cwdPath.match(/conductor\/workspaces\/([^/]+)\/([^/]+)/);
  if (m) return `${m[1]}/${m[2]}`;
  return path.basename(cwdPath);
}

function parseAllEntries(content: string): ClaudeSessionEntry[] {
  const entries: ClaudeSessionEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return entries;
}

function getContentBlocks(entry: ClaudeSessionEntry) {
  const c = entry.message?.content;
  if (!c || typeof c === "string") return [];
  return c;
}

function summarizeToolInput(name: string, input?: Record<string, unknown>): string {
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

function buildTimeline(entries: ClaudeSessionEntry[]): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];
  const seenSubAgents = new Set<string>();

  for (const entry of entries) {
    const ts = entry.timestamp;
    if (!ts) continue;

    // Sub-agent launch (deduplicate: only show first occurrence per agent)
    if (entry.type === "progress" && entry.data?.type === "agent_progress" && entry.data.agentId) {
      if (!seenSubAgents.has(entry.data.agentId)) {
        seenSubAgents.add(entry.data.agentId);
        timeline.push({
          timestamp: ts,
          kind: "sub_agent",
          text: `Launched sub-agent ${entry.data.agentId}${entry.data.prompt ? ": " + entry.data.prompt.slice(0, 150) : ""}`,
          agentId: entry.data.agentId,
        });
      }
      continue;
    }

    // Skip non-message types
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (!entry.message) continue;

    // Skip sidechain entries (sub-agent work) in the parent timeline
    if (entry.isSidechain) continue;

    const blocks = getContentBlocks(entry);
    const stringContent = typeof entry.message.content === "string" ? entry.message.content : null;

    // Token usage for this message
    const usage = entry.message.usage
      ? {
          inputTokens: entry.message.usage.input_tokens || 0,
          outputTokens: entry.message.usage.output_tokens || 0,
          cacheReadTokens: entry.message.usage.cache_read_input_tokens || 0,
          cacheCreationTokens: entry.message.usage.cache_creation_input_tokens || 0,
        }
      : undefined;

    // User message with text content
    if (entry.type === "user" && entry.userType === "external") {
      const text = stringContent || blocks.find((b) => b.type === "text")?.text;
      if (text) {
        timeline.push({ timestamp: ts, kind: "user", text: text.slice(0, 500) });
      }
      continue;
    }

    // Tool results (user messages that contain tool_result blocks)
    if (entry.type === "user") {
      for (const block of blocks) {
        if (block.type === "tool_result") {
          const resultText = typeof block.content === "string" ? block.content : "";
          timeline.push({
            timestamp: ts,
            kind: "tool_result",
            text: resultText.slice(0, 300),
            isError: block.is_error ?? false,
          });
        }
      }
      continue;
    }

    // Assistant messages
    if (entry.type === "assistant") {
      for (const block of blocks) {
        if (block.type === "tool_use" && block.name) {
          timeline.push({
            timestamp: ts,
            kind: "tool_use",
            text: summarizeToolInput(block.name, block.input),
            toolName: block.name,
            tokenUsage: usage,
          });
        } else if (block.type === "text" && block.text) {
          const trimmed = block.text.trim();
          if (trimmed.length > 0) {
            timeline.push({
              timestamp: ts,
              kind: "assistant",
              text: trimmed.slice(0, 500),
              tokenUsage: usage,
            });
          }
        }
      }
      // If no content blocks but has string content
      if (blocks.length === 0 && stringContent) {
        timeline.push({
          timestamp: ts,
          kind: "assistant",
          text: stringContent.slice(0, 500),
          tokenUsage: usage,
        });
      }
    }
  }

  return timeline;
}

async function readSubAgents(
  sessionDir: string
): Promise<SubAgentInfo[]> {
  const subagentsDir = path.join(sessionDir, "subagents");
  let files: string[];
  try {
    files = await fs.readdir(subagentsDir);
  } catch {
    return [];
  }

  const agentFiles = files.filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"));

  const results = await Promise.allSettled(
    agentFiles.map(async (file) => {
      const filePath = path.join(subagentsDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const entries = parseAllEntries(content);
      if (entries.length === 0) return null;

      const agentId = file.replace("agent-", "").replace(".jsonl", "");

      let model: string | null = null;
      let messageCount = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheCreationTokens = 0;

      // Extract first user message as prompt
      let prompt: string | null = null;

      for (const e of entries) {
        if (!model && e.message?.model) model = e.message.model;
        if (e.type === "user" || e.type === "assistant") messageCount++;
        if (e.message?.usage) {
          inputTokens += e.message.usage.input_tokens || 0;
          outputTokens += e.message.usage.output_tokens || 0;
          cacheReadTokens += e.message.usage.cache_read_input_tokens || 0;
          cacheCreationTokens += e.message.usage.cache_creation_input_tokens || 0;
        }
        if (!prompt && e.type === "user") {
          const c = e.message?.content;
          if (typeof c === "string") {
            prompt = c.slice(0, 200);
          } else if (Array.isArray(c)) {
            const textBlock = c.find((b) => b.type === "text" && b.text);
            if (textBlock?.text) prompt = textBlock.text.slice(0, 200);
          }
        }
      }

      return {
        agentId,
        prompt,
        model: model ? shortenModel(model) : null,
        messageCount,
        tokenUsage: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
      } satisfies SubAgentInfo;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<SubAgentInfo | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((s): s is SubAgentInfo => s !== null);
}

async function readTasks(sessionId: string): Promise<TaskInfo[]> {
  const tasksDir = path.join(TASKS_DIR, sessionId);
  let files: string[];
  try {
    files = await fs.readdir(tasksDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort((a, b) => {
    const numA = parseInt(a.replace(".json", ""), 10);
    const numB = parseInt(b.replace(".json", ""), 10);
    return numA - numB;
  });

  const tasks: TaskInfo[] = [];
  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(path.join(tasksDir, file), "utf-8");
      const data = JSON.parse(raw);
      // Handle both single task and array formats
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.subject || item.content) {
            tasks.push({
              id: item.id || file.replace(".json", ""),
              subject: item.subject || item.content || "Untitled",
              status: item.status || "pending",
              activeForm: item.activeForm,
            });
          }
        }
      } else if (data.subject || data.content) {
        tasks.push({
          id: data.id || file.replace(".json", ""),
          subject: data.subject || data.content || "Untitled",
          status: data.status || "pending",
          activeForm: data.activeForm,
        });
      }
    } catch {
      // skip malformed task files
    }
  }
  return tasks;
}

export async function readSessionDetail(
  sessionId: string,
  projectDir: string
): Promise<SessionDetailResponse | null> {
  const projPath = path.join(PROJECTS_DIR, projectDir);
  const jsonlPath = path.join(projPath, `${sessionId}.jsonl`);

  let content: string;
  let fileStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    [content, fileStat] = await Promise.all([
      fs.readFile(jsonlPath, "utf-8"),
      fs.stat(jsonlPath),
    ]);
  } catch {
    return null;
  }

  const entries = parseAllEntries(content);
  if (entries.length === 0) return null;

  // Extract metadata
  let slug: string | null = null;
  let model: string | null = null;
  let gitBranch: string | null = null;
  let cwd: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (const e of entries) {
    if (!slug && e.slug) slug = e.slug;
    if (!model && e.message?.model) model = e.message.model;
    if (!gitBranch && e.gitBranch) gitBranch = e.gitBranch;
    if (!cwd && e.cwd) cwd = e.cwd;
    if (e.message?.usage) {
      inputTokens += e.message.usage.input_tokens || 0;
      outputTokens += e.message.usage.output_tokens || 0;
      cacheReadTokens += e.message.usage.cache_read_input_tokens || 0;
      cacheCreationTokens += e.message.usage.cache_creation_input_tokens || 0;
    }
  }

  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  const projectPath = cwd || projectDir.replace(/^-/, "/").replace(/-/g, "/");
  const status = getStatus(fileStat.mtimeMs);
  const fallbackTime = new Date(fileStat.mtimeMs).toISOString();

  const timeline = buildTimeline(entries);

  // Read sub-agents from {sessionId}/subagents/ directory
  const sessionDir = path.join(projPath, sessionId);
  const subAgents = await readSubAgents(sessionDir);

  const tasks = await readTasks(sessionId);

  return {
    session: {
      sessionId,
      slug,
      projectName: extractProjectName(projectPath),
      projectPath,
      gitBranch,
      model: model ? shortenModel(model) : null,
      status,
      created: firstEntry?.timestamp || fallbackTime,
      lastActivity: lastEntry?.timestamp || fallbackTime,
      totalTokens: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
    },
    timeline,
    subAgents,
    tasks,
  };
}

export async function readSubAgentDetail(
  sessionId: string,
  projectDir: string,
  agentId: string
): Promise<SessionDetailResponse | null> {
  const agentPath = path.join(
    PROJECTS_DIR,
    projectDir,
    sessionId,
    "subagents",
    `agent-${agentId}.jsonl`
  );

  let content: string;
  let fileStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    [content, fileStat] = await Promise.all([
      fs.readFile(agentPath, "utf-8"),
      fs.stat(agentPath),
    ]);
  } catch {
    return null;
  }

  const entries = parseAllEntries(content);
  if (entries.length === 0) return null;

  let slug: string | null = null;
  let model: string | null = null;
  let gitBranch: string | null = null;
  let cwd: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (const e of entries) {
    if (!slug && e.slug) slug = e.slug;
    if (!model && e.message?.model) model = e.message.model;
    if (!gitBranch && e.gitBranch) gitBranch = e.gitBranch;
    if (!cwd && e.cwd) cwd = e.cwd;
    if (e.message?.usage) {
      inputTokens += e.message.usage.input_tokens || 0;
      outputTokens += e.message.usage.output_tokens || 0;
      cacheReadTokens += e.message.usage.cache_read_input_tokens || 0;
      cacheCreationTokens += e.message.usage.cache_creation_input_tokens || 0;
    }
  }

  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  const projectPath = cwd || projectDir.replace(/^-/, "/").replace(/-/g, "/");
  const status = getStatus(fileStat.mtimeMs);
  const fallbackTime = new Date(fileStat.mtimeMs).toISOString();

  // Sub-agents don't filter out sidechains -- all entries are their own
  const timeline = buildSubAgentTimeline(entries);

  return {
    session: {
      sessionId: `${sessionId}:${agentId}`,
      slug: slug ? `${slug} / ${agentId}` : agentId,
      projectName: extractProjectName(projectPath),
      projectPath,
      gitBranch,
      model: model ? shortenModel(model) : null,
      status,
      created: firstEntry?.timestamp || fallbackTime,
      lastActivity: lastEntry?.timestamp || fallbackTime,
      totalTokens: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
    },
    timeline,
    subAgents: [],
    tasks: [],
  };
}

// Sub-agent timeline doesn't skip sidechains (everything is its own work)
function buildSubAgentTimeline(entries: ClaudeSessionEntry[]): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];

  for (const entry of entries) {
    const ts = entry.timestamp;
    if (!ts) continue;

    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (!entry.message) continue;

    const blocks = getContentBlocks(entry);
    const stringContent = typeof entry.message.content === "string" ? entry.message.content : null;

    const usage = entry.message.usage
      ? {
          inputTokens: entry.message.usage.input_tokens || 0,
          outputTokens: entry.message.usage.output_tokens || 0,
          cacheReadTokens: entry.message.usage.cache_read_input_tokens || 0,
          cacheCreationTokens: entry.message.usage.cache_creation_input_tokens || 0,
        }
      : undefined;

    // User text message (first message is the prompt)
    if (entry.type === "user" && (entry.userType === "external" || entry.userType === "internal")) {
      const text = stringContent || blocks.find((b) => b.type === "text")?.text;
      if (text) {
        timeline.push({ timestamp: ts, kind: "user", text: text.slice(0, 500) });
        continue;
      }
    }

    // Tool results
    if (entry.type === "user") {
      for (const block of blocks) {
        if (block.type === "tool_result") {
          const resultText = typeof block.content === "string" ? block.content : "";
          timeline.push({
            timestamp: ts,
            kind: "tool_result",
            text: resultText.slice(0, 300),
            isError: block.is_error ?? false,
          });
        }
      }
      continue;
    }

    // Assistant messages
    if (entry.type === "assistant") {
      for (const block of blocks) {
        if (block.type === "tool_use" && block.name) {
          timeline.push({
            timestamp: ts,
            kind: "tool_use",
            text: summarizeToolInput(block.name, block.input),
            toolName: block.name,
            tokenUsage: usage,
          });
        } else if (block.type === "text" && block.text) {
          const trimmed = block.text.trim();
          if (trimmed.length > 0) {
            timeline.push({
              timestamp: ts,
              kind: "assistant",
              text: trimmed.slice(0, 500),
              tokenUsage: usage,
            });
          }
        }
      }
      if (blocks.length === 0 && stringContent) {
        timeline.push({
          timestamp: ts,
          kind: "assistant",
          text: stringContent.slice(0, 500),
          tokenUsage: usage,
        });
      }
    }
  }

  return timeline;
}
