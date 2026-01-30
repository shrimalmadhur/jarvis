import fs from "node:fs/promises";
import path from "node:path";
import type { LLMToolDefinition } from "@/lib/ai/types";

export const BUILTIN_TOOL_NAMES = new Set([
  "get_current_time",
  "list_directory",
  "read_file",
  "write_file",
  "get_file_info",
]);

export const BUILTIN_TOOLS: LLMToolDefinition[] = [
  {
    name: "get_current_time",
    description:
      "Get the current date and time. Use this when the user asks about the current time or date.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            'IANA timezone string (e.g., "America/New_York"). Defaults to UTC.',
        },
      },
    },
  },
  {
    name: "list_directory",
    description:
      "List files and directories at a given path. Returns names, types (file/directory), and sizes.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the directory to list.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file. Returns the file content as text.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to read.",
        },
        maxBytes: {
          type: "number",
          description:
            "Maximum number of bytes to read. Defaults to 100000 (100KB). Use for large files.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to write.",
        },
        content: {
          type: "string",
          description: "The content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "get_file_info",
    description:
      "Get metadata about a file or directory: size, creation time, modification time, type.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file or directory.",
        },
      },
      required: ["path"],
    },
  },
];

export async function executeBuiltinTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case "get_current_time":
        return executeGetCurrentTime(args);
      case "list_directory":
        return await executeListDirectory(args);
      case "read_file":
        return await executeReadFile(args);
      case "write_file":
        return await executeWriteFile(args);
      case "get_file_info":
        return await executeGetFileInfo(args);
      default:
        return JSON.stringify({ error: `Unknown built-in tool: ${name}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}

function executeGetCurrentTime(args: Record<string, unknown>): string {
  const tz = (args.timezone as string) || "UTC";
  try {
    const now = new Date();
    const formatted = now.toLocaleString("en-US", {
      timeZone: tz,
      dateStyle: "full",
      timeStyle: "long",
    });
    return JSON.stringify({ time: formatted, timezone: tz, iso: now.toISOString() });
  } catch {
    return JSON.stringify({ time: new Date().toISOString(), timezone: "UTC" });
  }
}

async function executeListDirectory(args: Record<string, unknown>): Promise<string> {
  const dirPath = args.path as string;
  if (!dirPath) return JSON.stringify({ error: "path is required" });

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const items = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const item: { name: string; type: string; size?: number } = {
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      };
      if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          item.size = stat.size;
        } catch {
          // skip size on error
        }
      }
      return item;
    })
  );

  return JSON.stringify({ path: dirPath, entries: items, count: items.length });
}

async function executeReadFile(args: Record<string, unknown>): Promise<string> {
  const filePath = args.path as string;
  if (!filePath) return JSON.stringify({ error: "path is required" });

  const maxBytes = (args.maxBytes as number) || 100_000;
  const handle = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
    const content = buf.subarray(0, bytesRead).toString("utf-8");
    const stat = await handle.stat();
    return JSON.stringify({
      path: filePath,
      content,
      size: stat.size,
      truncated: stat.size > maxBytes,
    });
  } finally {
    await handle.close();
  }
}

async function executeWriteFile(args: Record<string, unknown>): Promise<string> {
  const filePath = args.path as string;
  const content = args.content as string;
  if (!filePath) return JSON.stringify({ error: "path is required" });
  if (content === undefined) return JSON.stringify({ error: "content is required" });

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  const stat = await fs.stat(filePath);
  return JSON.stringify({ path: filePath, size: stat.size, written: true });
}

async function executeGetFileInfo(args: Record<string, unknown>): Promise<string> {
  const filePath = args.path as string;
  if (!filePath) return JSON.stringify({ error: "path is required" });

  const stat = await fs.stat(filePath);
  return JSON.stringify({
    path: filePath,
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.size,
    created: stat.birthtime.toISOString(),
    modified: stat.mtime.toISOString(),
    accessed: stat.atime.toISOString(),
    permissions: stat.mode.toString(8),
  });
}
