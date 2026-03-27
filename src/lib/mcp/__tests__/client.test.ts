import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { MCPServerConfig } from "../types";

// Mock MCP SDK
const mockConnect = mock(async () => {});
const mockClose = mock(async () => {});
const mockListTools = mock(async () => ({
  tools: [
    { name: "tool1", description: "Tool 1", inputSchema: { type: "object" } },
    { name: "tool2", description: "Tool 2", inputSchema: { type: "object" } },
  ],
}));
const mockCallTool = mock(async () => ({
  content: [{ type: "text", text: "result" }],
  isError: false,
}));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mockConnect;
    close = mockClose;
    listTools = mockListTools;
    callTool = mockCallTool;
  },
}));

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor() {}
  },
}));

// Import the class directly (not the singleton) for test isolation
const { MCPClientManager } = await import("../client");

let manager: InstanceType<typeof MCPClientManager>;

function makeConfig(name: string): MCPServerConfig {
  return {
    id: `id-${name}`,
    name,
    command: "/usr/bin/test",
    args: [],
    env: {},
    enabled: true,
  };
}

beforeEach(() => {
  manager = new MCPClientManager();
  mockConnect.mockClear();
  mockClose.mockClear();
  mockListTools.mockClear();
  mockCallTool.mockClear();
  // Reset to default implementation
  mockListTools.mockImplementation(async () => ({
    tools: [
      { name: "tool1", description: "Tool 1", inputSchema: { type: "object" } },
      { name: "tool2", description: "Tool 2", inputSchema: { type: "object" } },
    ],
  }));
  mockCallTool.mockImplementation(async () => ({
    content: [{ type: "text", text: "result" }],
    isError: false,
  }));
});

describe("MCPClientManager", () => {
  describe("initial state", () => {
    test("getConnectedServers returns empty initially", () => {
      expect(manager.getConnectedServers()).toEqual([]);
    });

    test("isConnected returns false for unknown server", () => {
      expect(manager.isConnected("unknown")).toBe(false);
    });
  });

  describe("connect", () => {
    test("connects to a server", async () => {
      await manager.connect(makeConfig("server1"));
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(manager.isConnected("server1")).toBe(true);
      expect(manager.getConnectedServers()).toEqual(["server1"]);
    });

    test("reconnect: disconnects existing before connecting new", async () => {
      await manager.connect(makeConfig("server1"));
      await manager.connect(makeConfig("server1"));

      // Should have closed first connection, then connected again
      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(manager.isConnected("server1")).toBe(true);
    });
  });

  describe("disconnect", () => {
    test("disconnects and removes server entry", async () => {
      await manager.connect(makeConfig("server1"));
      await manager.disconnect("server1");

      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(manager.isConnected("server1")).toBe(false);
      expect(manager.getConnectedServers()).toEqual([]);
    });

    test("does nothing for unknown server", async () => {
      await manager.disconnect("unknown");
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe("disconnectAll", () => {
    test("disconnects all connected servers", async () => {
      await manager.connect(makeConfig("server1"));
      await manager.connect(makeConfig("server2"));
      await manager.disconnectAll();

      expect(mockClose).toHaveBeenCalledTimes(2);
      expect(manager.getConnectedServers()).toEqual([]);
    });
  });

  describe("listTools", () => {
    test("returns tools from connected server", async () => {
      await manager.connect(makeConfig("server1"));
      const tools = await manager.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("tool1");
      expect(tools[0].serverName).toBe("server1");
      expect(tools[1].name).toBe("tool2");
    });

    test("caches tools per server", async () => {
      await manager.connect(makeConfig("server1"));

      await manager.listTools();
      await manager.listTools();

      // listTools on the SDK client should only be called once (cached)
      expect(mockListTools).toHaveBeenCalledTimes(1);
    });

    test("aggregates tools from multiple servers", async () => {
      mockListTools.mockImplementationOnce(async () => ({
        tools: [{ name: "toolA", description: "A", inputSchema: {} }],
      }));
      mockListTools.mockImplementationOnce(async () => ({
        tools: [{ name: "toolB", description: "B", inputSchema: {} }],
      }));

      await manager.connect(makeConfig("server1"));
      await manager.connect(makeConfig("server2"));
      const tools = await manager.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("toolA");
      expect(tools[0].serverName).toBe("server1");
      expect(tools[1].name).toBe("toolB");
      expect(tools[1].serverName).toBe("server2");
    });

    test("returns empty array when no servers connected", async () => {
      const tools = await manager.listTools();
      expect(tools).toEqual([]);
    });
  });

  describe("callTool", () => {
    test("dispatches to correct server", async () => {
      await manager.connect(makeConfig("server1"));
      const result = await manager.callTool("tool1", { arg: "value" });

      expect(mockCallTool).toHaveBeenCalledTimes(1);
      expect(result.content[0]).toEqual({ type: "text", text: "result" });
      expect(result.isError).toBe(false);
    });

    test("returns error for unknown tool", async () => {
      await manager.connect(makeConfig("server1"));
      const result = await manager.callTool("nonexistent_tool", {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    test("returns error when no servers connected", async () => {
      const result = await manager.callTool("any_tool", {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    test("swallows errors from matching server and returns 'not found'", async () => {
      mockCallTool.mockImplementation(async () => {
        throw new Error("server crashed");
      });

      await manager.connect(makeConfig("server1"));
      const result = await manager.callTool("tool1", {});

      // Error is caught, and since no other server has the tool, returns "not found"
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("disconnect invalidates cache", () => {
    test("tools from disconnected server are gone", async () => {
      await manager.connect(makeConfig("server1"));
      const toolsBefore = await manager.listTools();
      expect(toolsBefore).toHaveLength(2);

      await manager.disconnect("server1");
      const toolsAfter = await manager.listTools();
      expect(toolsAfter).toEqual([]);
    });
  });
});
