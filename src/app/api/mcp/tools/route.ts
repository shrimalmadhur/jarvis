import { NextResponse } from "next/server";
import { getMCPClientManager } from "@/lib/mcp/client";
import { BUILTIN_TOOLS } from "@/lib/agent/builtin-tools";

export async function GET() {
  try {
    const manager = getMCPClientManager();
    const mcpTools = await manager.listTools();

    return NextResponse.json({
      builtinTools: BUILTIN_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        source: "built-in",
      })),
      mcpTools,
      connectedServers: manager.getConnectedServers(),
    });
  } catch (error) {
    console.error("Error listing MCP tools:", error);
    return NextResponse.json(
      { error: "Failed to list tools" },
      { status: 500 }
    );
  }
}
