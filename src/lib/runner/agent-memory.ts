import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";

const MEMORY_FILE = "memory.md";
const ARCHIVE_FILE = "memory-archive.md";

/**
 * Env var keys that must not be overridden by agent config.
 * Shared between main agent and memory sub-agent.
 */
export const DENIED_ENV_KEYS = new Set([
  "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS",
  "HOME", "SHELL", "USER", "LOGNAME", "DYLD_INSERT_LIBRARIES",
]);

/** Build a child process env by merging agent envVars (with deny-list) into process.env. */
export function buildChildEnv(envVars?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0" };
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      if (!DENIED_ENV_KEYS.has(key.toUpperCase())) {
        env[key] = value;
      }
    }
  }
  return env;
}
const MAX_MEMORY_CHARS = 16000; // Cap injected memory — generous to fit full dedup lists
const COMPACTION_THRESHOLD = 10000; // Trigger compaction when memory exceeds this (must be < MAX_MEMORY_CHARS)
const MEMORY_SUB_AGENT_TIMEOUT_MS = 30_000; // 30 seconds
const ARCHIVE_DELIMITER = "---ARCHIVE---"; // Separates memory from archive in sub-agent output
const MAX_ARCHIVE_BYTES = 100_000; // Cap archive at ~100KB to prevent unbounded growth

/**
 * Read an agent's memory file from its workspace directory.
 * Returns the file contents, or empty string if no memory exists yet.
 */
export function readWorkspaceMemory(workspaceDir: string): string {
  const memoryPath = join(workspaceDir, MEMORY_FILE);
  if (!existsSync(memoryPath)) return "";

  try {
    const content = readFileSync(memoryPath, "utf-8").trim();
    if (content.length > MAX_MEMORY_CHARS) {
      return content.substring(0, MAX_MEMORY_CHARS) + "\n\n[memory truncated — keep this file concise]";
    }
    return content;
  } catch {
    return "";
  }
}

/**
 * Format workspace memory for injection into the agent's prompt.
 */
export function formatMemoryForPrompt(memoryContent: string, hasArchive: boolean = false): string {
  if (!memoryContent) return "";

  const parts = [
    "## Your Memory (from previous runs)",
    "This is your persistent memory file (`memory.md` in your workspace).",
    "It contains what you chose to remember from past runs.",
    "Use this to avoid repeating work and to build on what you've already done.",
  ];

  if (hasArchive) {
    parts.push(
      "Detailed history from older runs is available in `memory-archive.md` in your workspace.",
      "Read it if you need specifics about past work not covered in the summary below."
    );
  }

  parts.push("", "---", memoryContent, "---", "");
  return parts.join("\n");
}

/** Check if an archive file exists in the workspace. */
export function hasWorkspaceArchive(workspaceDir: string): boolean {
  return existsSync(join(workspaceDir, ARCHIVE_FILE));
}

/**
 * Read-only memory context note appended to the agent's system prompt.
 * Tells the agent memory exists and is handled automatically — no write instructions.
 */
export const MEMORY_CONTEXT_NOTE = `

## Persistent Memory
Your memory from previous runs is provided in the prompt under "Your Memory (from previous runs)".
Use it to avoid repeating work and to build on what you've done before.
Memory updates are handled automatically by the system — do not write to memory.md yourself.
If an archive file (\`memory-archive.md\`) is mentioned, you can read it for detailed history from older runs.
`;

/**
 * Extract the ## Memory section from skill text.
 * Returns the section content (without the heading), or null if not found.
 */
export function extractMemorySection(skill: string): string | null {
  // Split skill text into sections by ## headings, find the Memory section
  const sections = skill.split(/^(?=##\s)/m);
  const memorySection = sections.find((s) => /^##\s+Memory\s*$/im.test(s.split("\n")[0]));
  if (!memorySection) return null;
  // Remove the heading line and trim
  const content = memorySection.replace(/^##\s+Memory\s*\n?/im, "").trim();
  return content || null;
}

/**
 * Parse the memory sub-agent's output into memory and archive parts.
 * Only splits on the archive delimiter when compaction was requested,
 * and uses line-anchored matching to avoid false splits inside code blocks.
 */
export function parseSubAgentOutput(
  output: string,
  needsCompaction: boolean
): { memory: string; archive?: string } {
  const trimmed = output.trim();
  if (!trimmed) return { memory: "" };

  const delimMatch = needsCompaction ? trimmed.match(/^\s*---ARCHIVE---\s*$/m) : null;

  if (delimMatch && delimMatch.index !== undefined) {
    const memoryPart = trimmed.substring(0, delimMatch.index).trim();
    const archivePart = trimmed.substring(delimMatch.index + delimMatch[0].length).trim();
    return {
      memory: memoryPart || "(compacted — see memory-archive.md)",
      archive: archivePart || undefined,
    };
  }

  return { memory: trimmed };
}

/**
 * Spawn a memory sub-agent to update the agent's memory.md after a successful run.
 * This is a separate Claude CLI invocation with no tools — pure text generation.
 * The sub-agent receives the current memory + truncated run output + tracking instructions,
 * and returns the updated memory content which is written to memory.md.
 *
 * Best-effort: failures are logged but do not affect the run result.
 */
export async function updateMemoryAfterRun(opts: {
  workspaceDir: string;
  currentMemory: string;
  runOutput: string;
  skill: string;
  envVars?: Record<string, string>;
}): Promise<void> {
  const { workspaceDir, currentMemory, runOutput, skill, envVars } = opts;

  const memorySection = extractMemorySection(skill);
  const trackingInstructions = memorySection
    ? `Follow these tracking instructions from the agent's task:\n${memorySection}`
    : "Track what was done so future runs can avoid repeating work. Track topics covered, approaches that worked, and any useful state.";

  // Truncate run output to avoid blowing up the sub-agent's context
  const maxOutputChars = 4000;
  const truncatedOutput = runOutput.length > maxOutputChars
    ? runOutput.substring(0, maxOutputChars) + "\n\n[output truncated]"
    : runOutput;

  const needsCompaction = currentMemory.length > COMPACTION_THRESHOLD;

  const compactionRules = needsCompaction ? [
    "",
    "## Compaction Required",
    `The current memory is ${currentMemory.length} characters, which exceeds the ${COMPACTION_THRESHOLD} char budget.`,
    "You MUST compact it:",
    "- KEEP the complete list of all processed/covered items (names only, no dates, scores, or details). This list is critical for deduplication — never drop items from it.",
    "- Use a compact CSV format for item lists: `Item A, Item B, Item C` — one line, comma-separated, names only.",
    "- Aggressively compress everything else: notes, setup details, approaches, working configs.",
    "- Move verbose details (per-item analysis, dated entries, setup logs) to the archive section.",
    "",
    "## Output Format (compaction mode)",
    "Output the compacted memory.md content first.",
    `Then on its own line output exactly: ${ARCHIVE_DELIMITER}`,
    "Then output the detailed entries being archived (these will be APPENDED to memory-archive.md).",
    "Start the archive section with a date header like: ## Archived on YYYY-MM-DD",
    "",
    "Example:",
    "```",
    "## Processed Items (47 total)",
    "Quinoa, Chia Seeds, Oat Milk, Tempeh, Spirulina, Kale, Turmeric, Lentils, ...",
    "",
    "## Notes",
    "API: nutrition-api.com/v2, rate limit 10/min",
    `${ARCHIVE_DELIMITER}`,
    "## Archived on 2026-03-16",
    "- Quinoa (2026-02-01, score 72/100): high fiber, complete protein...",
    "- Chia Seeds (2026-02-05, score 85/100): omega-3 rich...",
    "```",
  ] : [];

  const prompt = [
    "You are a memory management assistant. Your job is to update an agent's persistent memory file based on what it just did.",
    "",
    "## Current Memory",
    currentMemory || "(empty — this is the first run)",
    "",
    "## Agent's Latest Output",
    truncatedOutput,
    "",
    "## Instructions",
    trackingInstructions,
    ...compactionRules,
    "",
    "## Rules",
    "- Output ONLY the updated memory.md content — no commentary, no markdown fences, no preamble.",
    `- Keep memory.md under ${COMPACTION_THRESHOLD} characters — this file is injected into every future run's prompt.`,
    "- Update incrementally — add new info, remove stale entries.",
    "- Do NOT store the full output or restate task instructions.",
    "- Use markdown format with clear sections.",
    ...(needsCompaction ? [] : [`- If you don't need to archive anything, do NOT include the ${ARCHIVE_DELIMITER} line.`]),
  ].join("\n");

  const args = [
    "-p",
    "--output-format", "text",
    "--no-session-persistence",
    "--max-turns", "1",
  ];

  const childEnv = buildChildEnv(envVars);

  // Cap on sub-agent output to prevent memory exhaustion
  const maxSubAgentOutput = MAX_MEMORY_CHARS * 2;

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const proc = spawn(resolveClaudePath(), args, {
      env: childEnv,
      cwd: workspaceDir,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(new Error("memory sub-agent timed out after 30s"));
    }, MEMORY_SUB_AGENT_TIMEOUT_MS);

    proc.stdin!.write(prompt);
    proc.stdin!.end();

    let output = "";

    proc.stdout!.on("data", (chunk: Buffer) => {
      if (output.length >= maxSubAgentOutput) return;
      output += chunk.toString();
      if (output.length > maxSubAgentOutput) {
        output = output.substring(0, maxSubAgentOutput);
      }
    });

    proc.stderr!.on("data", () => {
      // Ignore stderr from sub-agent
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (settled) return; // Don't write after timeout or error — promise already settled
      settled = true;

      const trimmed = output.trim();

      if (code === 0 && trimmed) {
        try {
          const parsed = parseSubAgentOutput(trimmed, needsCompaction);

          // Archive first — if this fails, uncompacted memory is still intact
          if (parsed.archive) {
            const archivePath = join(workspaceDir, ARCHIVE_FILE);
            let skipArchive = false;
            if (existsSync(archivePath)) {
              try {
                if (statSync(archivePath).size > MAX_ARCHIVE_BYTES) {
                  console.warn("[memory sub-agent] archive exceeds 100KB, skipping append");
                  skipArchive = true;
                }
              } catch { /* stat failed, try to append anyway */ }
            }
            if (!skipArchive) {
              const prefix = existsSync(archivePath) ? "\n" : "";
              appendFileSync(archivePath, prefix + parsed.archive + "\n", "utf-8");
            }
          }

          if (parsed.memory) {
            writeFileSync(join(workspaceDir, MEMORY_FILE), parsed.memory + "\n", "utf-8");
          }
        } catch (err) {
          console.warn("[memory sub-agent] failed to write memory.md:", err);
        }
      } else if (code !== 0) {
        console.warn(`[memory sub-agent] exited with code ${code}, skipping memory update`);
      }

      resolve();
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(`memory sub-agent spawn error: ${err.message}`));
    });
  });
}
