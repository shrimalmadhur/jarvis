import dotenv from "dotenv";
import fs from "node:fs";

// Load env: prefer .env.local (dev), fall back to /etc/jarvis/env (server)
if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else if (fs.existsSync("/etc/jarvis/env")) {
  dotenv.config({ path: "/etc/jarvis/env" });
}
import { loadAgentDefinitions } from "../src/lib/runner/config-loader";
import { runAgentTask } from "../src/lib/runner/agent-runner";
import { sendAgentResult } from "../src/lib/runner/telegram-sender";
import { logRun, getRecentOutputs } from "../src/lib/runner/run-log";

async function main() {
  const args = process.argv.slice(2);

  // Load all agent definitions
  const definitions = await loadAgentDefinitions();

  // --list: show configured agents
  if (args.includes("--list")) {
    if (definitions.length === 0) {
      console.log("No agents configured. Create agent folders in agents/");
      return;
    }
    console.log("Configured agents:\n");
    for (const def of definitions) {
      const schedule = def.config.schedule;
      const provider = def.config.llm?.provider || "gemini";
      const model = def.config.llm?.model || "gemini-3-flash-preview";
      console.log(
        `  ${def.config.name} [${schedule}] ${provider}/${model}`
      );
    }
    return;
  }

  // Filter to specific agent if name provided
  const targetAgent = args[0];
  const toRun = targetAgent
    ? definitions.filter((d) => d.config.name === targetAgent)
    : definitions;

  if (targetAgent && toRun.length === 0) {
    console.error(
      `Agent "${targetAgent}" not found. Available: ${definitions.map((d) => d.config.name).join(", ") || "none"}`
    );
    process.exit(1);
  }

  if (toRun.length === 0) {
    console.log("No enabled agents to run.");
    return;
  }

  // Run each agent
  for (const def of toRun) {
    console.log(`\n--- Running agent: ${def.config.name} ---`);

    // Get recent outputs for context (topic dedup)
    let recentOutputs: string[] = [];
    try {
      recentOutputs = await getRecentOutputs(def.config.name, 30);
    } catch {
      // DB might not have the table yet on first run
      console.warn("Could not load recent outputs (table may not exist yet)");
    }

    const result = await runAgentTask(def, { recentOutputs });
    console.log(`Status: ${result.success ? "SUCCESS" : "FAILED"}`);
    console.log(
      `Model: ${result.model} | Tokens: ${result.tokensUsed.prompt + result.tokensUsed.completion} | Time: ${(result.durationMs / 1000).toFixed(1)}s`
    );

    if (result.error) {
      console.error(`Error: ${result.error}`);
    }

    if (result.output) {
      console.log(`\nOutput:\n${result.output}\n`);
    }

    // Log run to DB
    try {
      await logRun(result);
    } catch (err) {
      console.error("Failed to log run:", err);
    }

    // Send to Telegram if successful
    if (result.success) {
      try {
        await sendAgentResult(
          def.config.telegram,
          def.config.name,
          result
        );
        console.log("Sent to Telegram.");
      } catch (err) {
        console.error("Failed to send to Telegram:", err);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
