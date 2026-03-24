import { loadEnv } from "./lib/load-env";
loadEnv();
import { loadAgentDefinitionsFromDB, loadAgentDefinitionById } from "../src/lib/runner/db-config-loader";
import { runAgentTask } from "../src/lib/runner/agent-runner";
import { sendAgentResult, sendAgentError, getAgentTelegramConfig } from "../src/lib/runner/telegram-sender";
import { logRun } from "../src/lib/runner/run-log";

async function runSingleAgent(def: Awaited<ReturnType<typeof loadAgentDefinitionsFromDB>>[number]) {
  console.log(`\n--- Running agent: ${def.config.name} ---`);

  const result = await runAgentTask(def);
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

  // Send to Telegram (success or failure)
  const telegramConfig = await getAgentTelegramConfig(def.config.name, def.agentId);
  if (telegramConfig) {
    try {
      if (result.success) {
        await sendAgentResult(telegramConfig, def.config.name, result);
        console.log("Sent to Telegram.");
      } else {
        await sendAgentError(telegramConfig, def.config.name, result);
        console.log("Sent error to Telegram.");
      }
    } catch (err) {
      console.error("Failed to send to Telegram:", err);
    }
  } else {
    console.log("No Telegram config found, skipping notification.");
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Parse --project flag
  let projectName: string | undefined;
  const projectIdx = args.indexOf("--project");
  if (projectIdx !== -1 && args[projectIdx + 1]) {
    projectName = args[projectIdx + 1];
    args.splice(projectIdx, 2);
  }

  // Parse --id flag (run a single agent by database ID)
  let agentId: string | undefined;
  const idIdx = args.indexOf("--id");
  if (idIdx !== -1 && args[idIdx + 1]) {
    agentId = args[idIdx + 1];
    args.splice(idIdx, 2);
  }

  // If --id is provided, load that single agent directly
  if (agentId) {
    const def = await loadAgentDefinitionById(agentId);
    if (!def) {
      console.error(`Agent with id "${agentId}" not found or disabled.`);
      process.exit(1);
    }
    await runSingleAgent(def);
    return;
  }

  // Load agents from DB
  const definitions = await loadAgentDefinitionsFromDB({
    projectName,
  });

  // --list: show configured agents
  if (args.includes("--list")) {
    if (definitions.length === 0) {
      console.log("No agents configured.");
      return;
    }
    console.log("Configured agents:\n");
    for (const def of definitions) {
      const schedule = def.config.schedule;
      const envCount = Object.keys(def.config.envVars || {}).length;
      console.log(
        `  ${def.config.name} [${schedule}] (id: ${def.agentId}) ${envCount} env vars`
      );
    }
    return;
  }

  // Filter to specific agent if name provided (legacy support)
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
    await runSingleAgent(def);
  }
}

main()
  .catch(async (err) => {
    console.error("Fatal error:", err);

    // Best-effort: send Telegram notification for script-level crashes
    try {
      const idIdx = process.argv.indexOf("--id");
      const agentId = idIdx !== -1 ? process.argv[idIdx + 1] : undefined;
      if (agentId) {
        const config = await getAgentTelegramConfig("", agentId);
        if (config) {
          const { sendTelegramMessage, escapeHtml } = await import("../src/lib/notifications/telegram");
          const errMsg = err instanceof Error ? err.message : String(err);
          await sendTelegramMessage(config,
            `<b>[CRASH] Agent ${escapeHtml(agentId)}</b>\n\n<pre>${escapeHtml(errMsg.substring(0, 3000))}</pre>`
          );
        }
      }
    } catch {
      // Telegram notification itself failed — nothing more we can do
    }

    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
