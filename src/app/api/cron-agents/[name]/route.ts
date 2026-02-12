import { NextResponse } from "next/server";
import { loadAgentDefinitions } from "@/lib/runner/config-loader";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  try {
    const definitions = await loadAgentDefinitions(undefined, {
      includeDisabled: true,
      resolveEnv: false,
    });

    const def = definitions.find((d) => d.config.name === name);
    if (!def) {
      return NextResponse.json(
        { error: `Agent "${name}" not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      name: def.config.name,
      enabled: def.config.enabled,
      schedule: def.config.schedule,
      timezone: def.config.timezone || null,
      model: def.config.llm?.model || null,
      provider: def.config.llm?.provider || "gemini",
      temperature: def.config.llm?.temperature || null,
      maxTokens: def.config.maxTokens || null,
      soul: def.soul,
      skill: def.skill,
    });
  } catch (error) {
    console.error("Error loading agent detail:", error);
    return NextResponse.json(
      { error: "Failed to load agent" },
      { status: 500 }
    );
  }
}
