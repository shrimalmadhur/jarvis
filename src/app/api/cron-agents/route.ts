import { NextResponse } from "next/server";
import { loadAgentDefinitions } from "@/lib/runner/config-loader";
import { db } from "@/lib/db";
import { agentRuns } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Convert common cron expressions to human-readable strings.
 */
function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  // "0 8 * * *" -> "Daily at 8:00 AM"
  if (dom === "*" && mon === "*" && dow === "*" && !hour.includes("/") && !min.includes("/")) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `Daily at ${displayHour}:${String(m).padStart(2, "0")} ${period}`;
    }
  }

  // "*/N * * * *" -> "Every N minutes"
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = min.slice(2);
    return n === "1" ? "Every minute" : `Every ${n} minutes`;
  }

  // "0 */N * * *" -> "Every N hours"
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    const n = hour.slice(2);
    return n === "1" ? "Every hour" : `Every ${n} hours`;
  }

  // "0 8 * * 1-5" -> "Weekdays at 8:00 AM"
  if (dom === "*" && mon === "*" && (dow === "1-5" || dow === "MON-FRI") && !hour.includes("/")) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `Weekdays at ${displayHour}:${String(m).padStart(2, "0")} ${period}`;
    }
  }

  return cron;
}

export async function GET() {
  try {
    const definitions = await loadAgentDefinitions(undefined, {
      includeDisabled: true,
      resolveEnv: false,
    });

    const agents = await Promise.all(
      definitions.map(async (def) => {
        const latestRuns = await db
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.agentName, def.config.name))
          .orderBy(desc(agentRuns.createdAt))
          .limit(1);

        const lastRun = latestRuns[0] || null;

        return {
          name: def.config.name,
          enabled: def.config.enabled,
          schedule: def.config.schedule,
          scheduleHuman: cronToHuman(def.config.schedule),
          timezone: def.config.timezone || null,
          model: def.config.llm?.model || null,
          provider: def.config.llm?.provider || "gemini",
          soulExcerpt: def.soul.slice(0, 150).replace(/\n/g, " ").trim(),
          lastRun: lastRun
            ? {
                status: lastRun.status,
                createdAt: lastRun.createdAt?.toISOString() || null,
                durationMs: lastRun.durationMs,
                promptTokens: lastRun.promptTokens,
                completionTokens: lastRun.completionTokens,
                error: lastRun.error,
              }
            : null,
        };
      })
    );

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Error loading cron agents:", error);
    return NextResponse.json(
      { error: "Failed to load agents" },
      { status: 500 }
    );
  }
}
