import { loadEnv } from "./lib/load-env";
loadEnv();

import { runIssuePipeline } from "../src/lib/issues/pipeline";
import { getIssuesTelegramConfig } from "../src/lib/issues/telegram-poller";

async function main() {
  const args = process.argv.slice(2);
  const issueIdx = args.indexOf("--issue");
  if (issueIdx === -1 || !args[issueIdx + 1]) {
    console.error("Usage: bun run scripts/issue-pipeline.ts --issue <issue-id>");
    process.exit(1);
  }
  const issueId = args[issueIdx + 1];

  const config = await getIssuesTelegramConfig();
  if (!config) {
    console.error("No Telegram issues bot configured. Set up via Issues > Config in the UI.");
    process.exit(1);
  }

  console.log(`Running pipeline for issue: ${issueId}`);
  await runIssuePipeline(issueId, config);
  console.log("Pipeline complete.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
