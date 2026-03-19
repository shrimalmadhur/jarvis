import { execFile } from "node:child_process";
import { join, resolve } from "node:path";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-sync the crontab with the current database state by running install-cron.sh.
 * Debounced (1.5s) to coalesce rapid mutations into a single sync.
 * Best-effort — failures are logged but don't propagate.
 */
export function syncCrontab(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const cwd = process.cwd();
    const scriptPath = resolve(cwd, "scripts", "install-cron.sh");

    const dbPath = process.env.DATABASE_PATH || join(cwd, "data", "dobby.db");
    execFile("bash", [scriptPath, "--run-dir", cwd], {
      timeout: 15_000,
      env: { ...process.env, DATABASE_PATH: dbPath },
    }, (err, stdout, stderr) => {
      if (err) {
        console.warn("[cron-sync] failed to sync crontab:", err.message);
        if (stderr) console.warn("[cron-sync] stderr:", stderr);
        return;
      }
      if (stdout.trim()) {
        console.log("[cron-sync]", stdout.trim());
      }
    });
  }, 1500);
}
