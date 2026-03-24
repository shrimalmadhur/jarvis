import { NextResponse } from "next/server";
import { getMCPClientManager } from "@/lib/mcp/client";
import { BUILTIN_TOOLS } from "@/lib/agent/builtin-tools";
import { withErrorHandler } from "@/lib/api/utils";

export const GET = withErrorHandler(async () => {
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
});
