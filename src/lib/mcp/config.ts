import { db, mcpServers } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { MCPServerConfig } from "./types";

/**
 * Load all enabled MCP server configs from the database.
 */
export async function loadMCPServerConfigs(): Promise<MCPServerConfig[]> {
  const servers = await db.query.mcpServers.findMany({
    where: eq(mcpServers.enabled, true),
  });

  return servers.map((s) => ({
    id: s.id,
    name: s.name,
    command: s.command,
    args: (s.args as string[]) || [],
    env: (s.env as Record<string, string>) || {},
    enabled: s.enabled,
  }));
}
