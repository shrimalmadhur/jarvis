import { loadEnv } from "./lib/load-env";
loadEnv();

import { getIssuesTelegramConfig } from "../src/lib/issues/telegram-poller";
import { getOffset, runPollerIteration, clearAllLocks } from "../src/lib/issues/poller-manager";

async function main() {
  console.log("Dobby Issue Poller started (standalone)");

  let config = await getIssuesTelegramConfig();
  if (!config) {
    console.log("No Telegram issues bot configured. Waiting for configuration...");
    console.log("Set up via Issues > Config in the Dobby UI.");

    while (true) {
      await new Promise(r => setTimeout(r, 30000));
      config = await getIssuesTelegramConfig();
      if (config) break;
    }
    console.log("Telegram config found. Starting poller...");
  }

  // Clear all locks on startup — no pipeline from a previous process can still be running
  await clearAllLocks();

  let offset = await getOffset();
  console.log(`Resuming from offset: ${offset}`);

  while (true) {
    try {
      // Re-check config periodically
      const freshConfig = await getIssuesTelegramConfig();
      if (freshConfig) config = freshConfig;

      offset = await runPollerIteration(config, offset);
    } catch (err) {
      console.error("Poller error:", err);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
