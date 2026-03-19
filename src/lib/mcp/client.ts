import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig, MCPToolDefinition, MCPToolResult } from "./types";

interface ConnectedServer {
  client: Client;
  transport: StdioClientTransport;
  config: MCPServerConfig;
}

/**
 * Manages connections to multiple MCP servers.
 * Each server runs as a subprocess via STDIO transport.
 */
export class MCPClientManager {
  private servers: Map<string, ConnectedServer> = new Map();

  /**
   * Connect to an MCP server.
   */
  async connect(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      await this.disconnect(config.name);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client(
      { name: "dobby", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport, { timeout: 120_000 });

    this.servers.set(config.name, { client, transport, config });
    console.log(`Connected to MCP server: ${config.name}`);
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (server) {
      await server.client.close();
      this.servers.delete(name);
      console.log(`Disconnected from MCP server: ${name}`);
    }
  }

  /**
   * Disconnect from all servers.
   */
  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.all(names.map((name) => this.disconnect(name)));
  }

  /**
   * List all tools from all connected servers.
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    const allTools: MCPToolDefinition[] = [];

    for (const [serverName, server] of this.servers) {
      try {
        const result = await server.client.listTools();
        for (const tool of result.tools) {
          allTools.push({
            name: tool.name,
            description: tool.description || "",
            inputSchema: tool.inputSchema as Record<string, unknown>,
            serverName,
          });
        }
      } catch (error) {
        console.error(`Error listing tools from ${serverName}:`, error);
      }
    }

    return allTools;
  }

  /**
   * Call a tool on the appropriate server.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    // Find which server has this tool
    for (const [, server] of this.servers) {
      try {
        const { tools } = await server.client.listTools();
        const hasTool = tools.some((t) => t.name === toolName);

        if (hasTool) {
          const result = await server.client.callTool({
            name: toolName,
            arguments: args,
          });

          return {
            content: (result.content as MCPToolResult["content"]) || [],
            isError: result.isError as boolean | undefined,
          };
        }
      } catch (error) {
        console.error(
          `Error calling tool ${toolName} on ${server.config.name}:`,
          error
        );
      }
    }

    return {
      content: [{ type: "text", text: `Tool "${toolName}" not found on any connected server.` }],
      isError: true,
    };
  }

  /**
   * Get list of connected server names.
   */
  getConnectedServers(): string[] {
    return [...this.servers.keys()];
  }

  /**
   * Check if a specific server is connected.
   */
  isConnected(name: string): boolean {
    return this.servers.has(name);
  }
}

// Singleton instance
let clientManager: MCPClientManager | null = null;

export function getMCPClientManager(): MCPClientManager {
  if (!clientManager) {
    clientManager = new MCPClientManager();
  }
  return clientManager;
}
