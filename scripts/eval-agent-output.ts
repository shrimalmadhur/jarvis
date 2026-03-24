/**
 * End-to-end eval script for agent output quality.
 * Runs a real agent and validates the output isn't degraded.
 *
 * Usage:
 *   bun run --tsconfig tsconfig.runner.json scripts/eval-agent-output.ts [agent-name]
 */

import { loadEnv } from "./lib/load-env";
loadEnv();

import { loadAgentDefinitionsFromDB } from "../src/lib/runner/db-config-loader";
import { runAgentTask, getAgentWorkspaceDir } from "../src/lib/runner/agent-runner";
import { readWorkspaceMemory } from "../src/lib/runner/agent-memory";

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const HOUSEKEEPING_PREFIXES = [
  "memory updated",
  "memory has been updated",
  "i've updated",
  "i have updated the memory",
  "updated memory",
  "saved to memory",
];

function check(name: string, passed: boolean, detail: string): CheckResult {
  const icon = passed ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${name}: ${detail}`);
  return { name, passed, detail };
}

async function main() {
  const targetAgent = process.argv[2];
  if (!targetAgent) {
    console.error("Usage: bun run --tsconfig tsconfig.runner.json scripts/eval-agent-output.ts <agent-name>");
    process.exit(1);
  }

  const definitions = await loadAgentDefinitionsFromDB({});
  const def = definitions.find((d) => d.config.name === targetAgent);
  if (!def) {
    console.error(`Agent "${targetAgent}" not found. Available: ${definitions.map((d) => d.config.name).join(", ")}`);
    process.exit(1);
  }

  const results: CheckResult[] = [];

  // --- Run 1 ---
  console.log(`\n=== Run 1: ${def.config.name} ===`);
  const result1 = await runAgentTask(def);
  console.log(`  Status: ${result1.success ? "SUCCESS" : "FAILED"} (${(result1.durationMs / 1000).toFixed(1)}s)`);

  if (!result1.success) {
    console.error(`  Run 1 failed: ${result1.error}`);
    process.exit(1);
  }

  // Check 1: Output is substantial
  results.push(
    check(
      "Run 1 output is substantial",
      result1.output.length > 200,
      `${result1.output.length} chars (need > 200)`
    )
  );

  // Check 2: Output does not start with housekeeping
  const outputLower1 = result1.output.toLowerCase().trim();
  const startsWithHousekeeping1 = HOUSEKEEPING_PREFIXES.some((p) => outputLower1.startsWith(p));
  results.push(
    check(
      "Run 1 output is not housekeeping",
      !startsWithHousekeeping1,
      startsWithHousekeeping1
        ? `Starts with: "${result1.output.substring(0, 80)}..."`
        : "Output starts with actual content"
    )
  );

  // Check 3: memory.md exists
  const workspaceDir = getAgentWorkspaceDir(def);
  const memory1 = readWorkspaceMemory(workspaceDir);
  results.push(
    check(
      "memory.md exists after run 1",
      memory1.length > 0,
      memory1.length > 0 ? `${memory1.length} chars` : "File missing or empty"
    )
  );

  // --- Run 2 ---
  console.log(`\n=== Run 2: ${def.config.name} ===`);
  const result2 = await runAgentTask(def);
  console.log(`  Status: ${result2.success ? "SUCCESS" : "FAILED"} (${(result2.durationMs / 1000).toFixed(1)}s)`);

  if (!result2.success) {
    console.error(`  Run 2 failed: ${result2.error}`);
    process.exit(1);
  }

  // Check 4: Run 2 output is still substantial (not degraded)
  results.push(
    check(
      "Run 2 output is substantial (not degraded)",
      result2.output.length > 200,
      `${result2.output.length} chars (need > 200)`
    )
  );

  // Check 5: Run 2 output is not housekeeping
  const outputLower2 = result2.output.toLowerCase().trim();
  const startsWithHousekeeping2 = HOUSEKEEPING_PREFIXES.some((p) => outputLower2.startsWith(p));
  results.push(
    check(
      "Run 2 output is not housekeeping",
      !startsWithHousekeeping2,
      startsWithHousekeeping2
        ? `Starts with: "${result2.output.substring(0, 80)}..."`
        : "Output starts with actual content"
    )
  );

  // Check 6: Run 2 covers different topic (basic dedup check)
  // Compare first 100 chars — if identical, likely repeating
  const snippet1 = result1.output.substring(0, 100);
  const snippet2 = result2.output.substring(0, 100);
  const isDifferent = snippet1 !== snippet2;
  results.push(
    check(
      "Run 2 covers different topic",
      isDifferent,
      isDifferent ? "Outputs differ (dedup working)" : "Outputs are identical — dedup may not be working"
    )
  );

  // --- Summary ---
  console.log("\n=== Summary ===");
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`  ${passed}/${total} checks passed`);

  if (passed < total) {
    console.log("\n  Failed checks:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`    - ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }

  console.log("\n  All checks passed!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
