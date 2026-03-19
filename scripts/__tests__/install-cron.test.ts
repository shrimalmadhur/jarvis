import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_DIR = join(import.meta.dir, ".tmp-cron-test");
const DB_PATH = join(PROJECT_DIR, "data", "dobby.db");
const SCRIPT_PATH = join(import.meta.dir, "..", "install-cron.sh");

const AGENT_ID = "11111111-2222-3333-4444-555555555555";
const AGENT_NAME = "my cool agent";
const AGENT_SCHEDULE = "30 6 * * 1-5";

beforeAll(() => {
  // Create a temp project dir with a test DB
  mkdirSync(join(PROJECT_DIR, "data"), { recursive: true });

  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'proj-1',
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      soul TEXT NOT NULL DEFAULT '',
      skill TEXT NOT NULL DEFAULT '',
      schedule TEXT,
      timezone TEXT,
      env_vars TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.prepare(
    `INSERT INTO agents (id, name, enabled, schedule) VALUES (?, ?, 1, ?)`
  ).run(AGENT_ID, AGENT_NAME, AGENT_SCHEDULE);

  // Also insert a disabled agent — should NOT appear
  db.prepare(
    `INSERT INTO agents (id, name, enabled, schedule) VALUES (?, ?, 0, ?)`
  ).run("disabled-id", "disabled-agent", "0 0 * * *");

  db.close();
});

afterAll(() => {
  rmSync(PROJECT_DIR, { recursive: true, force: true });
});

describe("install-cron.sh --dry-run", () => {
  test("generates cron entry with --id flag instead of agent name", () => {
    const output = execSync(
      `DATABASE_PATH="${DB_PATH}" bash "${SCRIPT_PATH}" --dry-run`,
      { cwd: PROJECT_DIR, encoding: "utf-8" }
    );

    // Should contain the agent ID with --id flag (single-quoted)
    expect(output).toContain(`--id '${AGENT_ID}'`);
    // Should NOT contain the agent name as a CLI argument to run-agents.ts
    expect(output).not.toContain(`run-agents.ts ${AGENT_NAME}`);
    expect(output).not.toContain(`run-agents.ts my`);
  });

  test("includes agent name in comment for readability", () => {
    const output = execSync(
      `DATABASE_PATH="${DB_PATH}" bash "${SCRIPT_PATH}" --dry-run`,
      { cwd: PROJECT_DIR, encoding: "utf-8" }
    );

    expect(output).toContain(`# Agent: ${AGENT_NAME}`);
    expect(output).toContain(`(${AGENT_ID})`);
  });

  test("uses the correct cron schedule", () => {
    const output = execSync(
      `DATABASE_PATH="${DB_PATH}" bash "${SCRIPT_PATH}" --dry-run`,
      { cwd: PROJECT_DIR, encoding: "utf-8" }
    );

    // The cron entry line should start with the schedule
    expect(output).toContain(AGENT_SCHEDULE);
  });

  test("excludes disabled agents", () => {
    const output = execSync(
      `DATABASE_PATH="${DB_PATH}" bash "${SCRIPT_PATH}" --dry-run`,
      { cwd: PROJECT_DIR, encoding: "utf-8" }
    );

    expect(output).not.toContain("disabled-agent");
    expect(output).not.toContain("disabled-id");
  });

  test("includes Dobby markers for crontab block management", () => {
    const output = execSync(
      `DATABASE_PATH="${DB_PATH}" bash "${SCRIPT_PATH}" --dry-run`,
      { cwd: PROJECT_DIR, encoding: "utf-8" }
    );

    expect(output).toContain("# --- Dobby Agents (auto-generated) ---");
    expect(output).toContain("# --- End Dobby Agents ---");
  });

  test("--run-dir overrides the cd target in cron entries", () => {
    const customDir = "/usr/local/lib/dobby";
    const output = execSync(
      `DATABASE_PATH="${DB_PATH}" bash "${SCRIPT_PATH}" --dry-run --run-dir "${customDir}"`,
      { cwd: PROJECT_DIR, encoding: "utf-8" }
    );

    // Path should be single-quoted in the cron entry
    expect(output).toContain(`cd '${customDir}' &&`);
    // Should NOT contain the script's own PROJECT_DIR (the repo root) in the cd command
    const repoRoot = join(SCRIPT_PATH, "..", "..");
    expect(output).not.toContain(`cd '${repoRoot}'`);
  });

  test("--run-dir does not affect DB query (only cd target)", () => {
    const output = execSync(
      `DATABASE_PATH="${DB_PATH}" bash "${SCRIPT_PATH}" --dry-run --run-dir /tmp/unrelated`,
      { cwd: PROJECT_DIR, encoding: "utf-8" }
    );

    // DB query still works — agent found despite --run-dir pointing elsewhere
    expect(output).toContain(`--id '${AGENT_ID}'`);
    // cd target uses the custom dir
    expect(output).toContain("cd '/tmp/unrelated' &&");
  });

  test("--run-dir without a value exits with error", () => {
    expect(() =>
      execSync(
        `DATABASE_PATH="${DB_PATH}" bash "${SCRIPT_PATH}" --run-dir 2>&1`,
        { cwd: PROJECT_DIR, encoding: "utf-8" }
      )
    ).toThrow();
  });
});
