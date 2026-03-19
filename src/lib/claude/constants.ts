import path from "node:path";
import os from "node:os";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");
export const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
export const TASKS_DIR = path.join(CLAUDE_DIR, "tasks");

export const ACTIVE_MS = 2 * 60 * 1000;
export const IDLE_MS = 10 * 60 * 1000;
