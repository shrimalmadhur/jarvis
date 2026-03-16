import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MEMORY_FILE = "memory.md";
const MAX_MEMORY_CHARS = 8000; // Cap injected memory to avoid blowing up context

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
export function formatMemoryForPrompt(memoryContent: string): string {
  if (!memoryContent) return "";

  return [
    "## Your Memory (from previous runs)",
    "This is your persistent memory file (`memory.md` in your workspace).",
    "It contains what you chose to remember from past runs.",
    "Use this to avoid repeating work and to build on what you've already done.",
    "",
    "---",
    memoryContent,
    "---",
    "",
  ].join("\n");
}

/**
 * System prompt instructions telling the agent how to use its memory file.
 * Appended to the agent's soul (system prompt).
 */
export const MEMORY_SYSTEM_INSTRUCTIONS = `

## Persistent Memory
You have a persistent memory file at \`./memory.md\` in your workspace directory.
This file survives across runs — anything you write there will be available next time.

**At the START of each run**: Your current memory file contents are provided in the prompt under "Your Memory (from previous runs)". You don't need to read the file yourself.

**BEFORE your final response**: Update \`./memory.md\` to track what you did, using your file tools (write_file, bash echo, etc.). Do this BEFORE writing your final text response — never after.

**Your final text response** (the last message you send, with NO tool calls after it) MUST be your complete deliverable — the full analysis, report, or output your task requires. Every run must produce the same quality and depth of output regardless of whether it's the first or hundredth run. Never end with a housekeeping remark like "Memory updated" — end with the actual content.

### What to track
Your task instructions may include a **## Memory** section that tells you exactly what to track (e.g., "track which ingredients you've analyzed"). If they do, follow those instructions precisely.

If your task instructions do NOT specify what to track, use your first run to analyze the task and create a sensible memory structure. Ask yourself:
- What items am I processing that I shouldn't repeat? (e.g., ingredients, topics, URLs)
- What setup or installation did I do that I'll need again?
- What approaches worked or failed that I should remember?

Then create \`./memory.md\` with sections that track those things.

### What to remember
- **Domain data**: Items you've already processed so you don't repeat them
- **Working approaches**: Commands, APIs, or techniques that succeeded
- **Environment state**: Packages installed, file paths created, configs set up
- **Things to avoid**: Approaches that failed, rate limits hit, broken endpoints

### Format
Structure the file however makes sense for your task. For example:

\`\`\`markdown
## Processed Items
- Item A (2025-03-10)
- Item B (2025-03-11)

## Working Setup
- Installed: bun add cheerio
- API endpoint: https://api.example.com/v2 (v1 is deprecated)

## Notes
- Rate limit: max 10 requests/minute
- Output format: keep paragraphs under 280 chars for Telegram
\`\`\`

### Rules
- Keep it concise — this file is injected into your prompt every run, so bloat wastes tokens
- Update incrementally — read what's there, add/modify, don't rewrite from scratch unless needed
- Remove stale entries when they're no longer relevant
- Do NOT store your full output or restate your task instructions
`;
