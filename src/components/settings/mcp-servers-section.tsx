"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Trash2,
  Power,
  PowerOff,
  Calendar,
  Mail,
  FolderOpen,
  Github,
  Globe,
  Database,
  MessageSquare,
  Search,
  Terminal,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react";

// --- Preset MCP Servers ---

interface MCPPreset {
  name: string;
  description: string;
  icon: React.ReactNode;
  command: string;
  args: string[];
  envKeys: { key: string; label: string; placeholder: string }[];
}

const MCP_PRESETS: MCPPreset[] = [
  {
    name: "google-calendar",
    description: "Read and manage Google Calendar events",
    icon: <Calendar className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@cocal/google-calendar-mcp"],
    envKeys: [
      {
        key: "GOOGLE_OAUTH_CREDENTIALS",
        label: "OAuth credentials JSON path",
        placeholder: "~/.config/gcp-oauth.keys.json",
      },
    ],
  },
  {
    name: "gmail",
    description: "Read and send emails via Gmail",
    icon: <Mail className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@anthropic/gmail-mcp"],
    envKeys: [],
  },
  {
    name: "google-drive",
    description: "Access and search Google Drive files",
    icon: <FolderOpen className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@anthropic/google-drive-mcp"],
    envKeys: [],
  },
  {
    name: "github",
    description: "Manage repos, issues, and pull requests",
    icon: <Github className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envKeys: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub Token",
        placeholder: "ghp_...",
      },
    ],
  },
  {
    name: "slack",
    description: "Read and send Slack messages",
    icon: <MessageSquare className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envKeys: [
      {
        key: "SLACK_BOT_TOKEN",
        label: "Bot Token",
        placeholder: "xoxb-...",
      },
    ],
  },
  {
    name: "brave-search",
    description: "Web search via Brave Search API",
    icon: <Search className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envKeys: [
      {
        key: "BRAVE_API_KEY",
        label: "Brave API Key",
        placeholder: "BSA...",
      },
    ],
  },
  {
    name: "filesystem",
    description: "Read and write local files",
    icon: <FolderOpen className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users"],
    envKeys: [],
  },
  {
    name: "postgres",
    description: "Query PostgreSQL databases",
    icon: <Database className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    envKeys: [
      {
        key: "POSTGRES_CONNECTION_STRING",
        label: "Connection String",
        placeholder: "postgresql://user:pass@host/db",
      },
    ],
  },
  {
    name: "fetch",
    description: "Fetch and read web page content",
    icon: <Globe className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    envKeys: [],
  },
  {
    name: "puppeteer",
    description: "Browser automation and screenshots",
    icon: <Globe className="h-4.5 w-4.5" />,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    envKeys: [],
  },
];

// --- Types ---

interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

import { settingsInputClasses as inputClasses } from "@/components/shared/form-classes";

function presetButtonClass(installed: boolean, isConfiguring: boolean): string {
  if (installed) return "cursor-default border-border/50 opacity-40";
  if (isConfiguring) return "border-accent/30 bg-accent-glow";
  return "border-border hover:border-border-hover hover:bg-surface-hover";
}

function presetIconClass(installed: boolean, isConfiguring: boolean): string {
  if (installed) return "text-muted";
  if (isConfiguring) return "text-accent";
  return "text-muted-foreground";
}

export function MCPServersSection() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [addingPreset, setAddingPreset] = useState<MCPPreset | null>(null);
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({});
  const [newServer, setNewServer] = useState({
    name: "",
    command: "",
    args: "",
    env: "",
  });

  useEffect(() => {
    fetchServers();
  }, []);

  const fetchServers = async () => {
    try {
      const res = await fetch("/api/mcp/servers");
      if (res.ok) {
        setServers(await res.json());
      }
    } catch (error) {
      console.error("Error fetching servers:", error);
    }
  };

  const addFromPreset = async (preset: MCPPreset) => {
    if (preset.envKeys.length > 0 && addingPreset?.name !== preset.name) {
      setAddingPreset(preset);
      setPresetEnvValues({});
      return;
    }

    const env: Record<string, string> = {};
    for (const ek of preset.envKeys) {
      if (presetEnvValues[ek.key]) {
        env[ek.key] = presetEnvValues[ek.key];
      }
    }

    try {
      const res = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          command: preset.command,
          args: preset.args,
          env,
        }),
      });

      if (res.ok) {
        setAddingPreset(null);
        setPresetEnvValues({});
        fetchServers();
      }
    } catch (error) {
      console.error("Error adding server:", error);
    }
  };

  const addCustomServer = async () => {
    if (!newServer.name || !newServer.command) return;

    try {
      const res = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newServer.name,
          command: newServer.command,
          args: newServer.args
            ? newServer.args.split(" ").filter(Boolean)
            : [],
          env: newServer.env ? JSON.parse(newServer.env) : {},
        }),
      });

      if (res.ok) {
        setNewServer({ name: "", command: "", args: "", env: "" });
        setShowCustom(false);
        fetchServers();
      }
    } catch (error) {
      console.error("Error adding server:", error);
    }
  };

  const toggleServer = async (id: string, enabled: boolean) => {
    try {
      await fetch(`/api/mcp/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      fetchServers();
    } catch (error) {
      console.error("Error toggling server:", error);
    }
  };

  const deleteServer = async (id: string) => {
    try {
      await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
      fetchServers();
    } catch (error) {
      console.error("Error deleting server:", error);
    }
  };

  const installedNames = new Set(servers.map((s) => s.name));

  return (
    <>
      {/* Active Servers */}
      {servers.length > 0 && (
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>Active Integrations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {servers.map((server) => (
              <div
                key={server.id}
                className="group flex items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors hover:border-border-hover"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        server.enabled ? "bg-green" : "bg-muted"
                      }`}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {server.name}
                    </span>
                  </div>
                  <p className="mt-0.5 pl-4 font-mono text-[12px] text-muted">
                    {server.command} {(server.args || []).join(" ")}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => toggleServer(server.id, server.enabled)}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                    title={server.enabled ? "Disable" : "Enable"}
                  >
                    {server.enabled ? (
                      <Power className="h-3.5 w-3.5" />
                    ) : (
                      <PowerOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => deleteServer(server.id)}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-red"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Preset Library */}
      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle>Integration Library</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5">
            {MCP_PRESETS.map((preset, idx) => {
              const installed = installedNames.has(preset.name);
              const isConfiguring = addingPreset?.name === preset.name;

              return (
                <div
                  key={preset.name}
                  className="animate-slide-up flex flex-col"
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  <button
                    disabled={installed}
                    onClick={() => {
                      if (preset.envKeys.length === 0) {
                        addFromPreset(preset);
                      } else {
                        setAddingPreset(isConfiguring ? null : preset);
                        setPresetEnvValues({});
                      }
                    }}
                    className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all duration-200 ${
                      presetButtonClass(installed, isConfiguring)
                    }`}
                  >
                    <div
                      className={`mt-0.5 ${
                        presetIconClass(installed, isConfiguring)
                      }`}
                    >
                      {preset.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-foreground">
                          {preset.name}
                        </span>
                        {installed && (
                          <Check className="h-3 w-3 text-green" />
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-snug text-muted">
                        {preset.description}
                      </p>
                    </div>
                  </button>

                  {/* Inline env config form */}
                  {isConfiguring && (
                    <div className="animate-fade-in mt-2 space-y-2.5 rounded-lg border border-border bg-surface-raised p-3">
                      {preset.envKeys.map((ek) => (
                        <div key={ek.key}>
                          <label className="mb-1 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                            {ek.label}
                          </label>
                          <input
                            type="text"
                            placeholder={ek.placeholder}
                            value={presetEnvValues[ek.key] || ""}
                            onChange={(e) =>
                              setPresetEnvValues({
                                ...presetEnvValues,
                                [ek.key]: e.target.value,
                              })
                            }
                            className={inputClasses}
                          />
                        </div>
                      ))}
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => addFromPreset(preset)}
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAddingPreset(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Custom server toggle */}
          <div className="border-t border-border pt-4">
            <button
              onClick={() => setShowCustom(!showCustom)}
              className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Terminal className="h-4 w-4" />
              <span>Custom integration</span>
              {showCustom ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>

            {showCustom && (
              <div className="animate-fade-in mt-3 space-y-3 rounded-lg border border-border p-4">
                <input
                  type="text"
                  placeholder="Server name (e.g., my-custom-mcp)"
                  value={newServer.name}
                  onChange={(e) =>
                    setNewServer({ ...newServer, name: e.target.value })
                  }
                  className={inputClasses}
                />
                <input
                  type="text"
                  placeholder="Command (e.g., npx)"
                  value={newServer.command}
                  onChange={(e) =>
                    setNewServer({ ...newServer, command: e.target.value })
                  }
                  className={inputClasses}
                />
                <input
                  type="text"
                  placeholder="Args (space-separated, e.g., -y @my/server)"
                  value={newServer.args}
                  onChange={(e) =>
                    setNewServer({ ...newServer, args: e.target.value })
                  }
                  className={inputClasses}
                />
                <input
                  type="text"
                  placeholder='Env vars as JSON (e.g., {"API_KEY": "..."})'
                  value={newServer.env}
                  onChange={(e) =>
                    setNewServer({ ...newServer, env: e.target.value })
                  }
                  className={inputClasses}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="accent" onClick={addCustomServer}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowCustom(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
