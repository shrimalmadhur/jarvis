import dotenv from "dotenv";
import fs from "node:fs";

// Load env: prefer .env.local (dev), fall back to /etc/jarvis/env (server)
if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else if (fs.existsSync("/etc/jarvis/env")) {
  dotenv.config({ path: "/etc/jarvis/env" });
}

import { migrateFilesystemAgents } from "../src/lib/db/auto-migrate";

async function main() {
  console.log("Migrating filesystem agents to database...\n");

  const { migrated, skipped } = await migrateFilesystemAgents({ verbose: true });

  console.log(`\nDone! Migrated: ${migrated}, Skipped: ${skipped}`);
  if (migrated > 0) {
    console.log(
      "\nRecommendation: After verifying DB agents work correctly,\n" +
      "disable or remove the filesystem agent folders in agents/ to prevent duplicate runs."
    );
  }
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
