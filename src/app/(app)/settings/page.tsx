"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus,
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
  X,
  Check,
  Send,
  Bell,
  Clock,
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

const inputClasses =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-border-hover input-focus";

export default function SettingsPage() {
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

  // Session retention state
  const [sessionRetentionDays, setSessionRetentionDays] = useState("");
  const [sessionRetentionSaving, setSessionRetentionSaving] = useState(false);
  const [sessionRetentionSaved, setSessionRetentionSaved] = useState(false);

  // Telegram notification state
  const [telegramConfig, setTelegramConfig] = useState({
    botToken: "",
    chatId: "",
    enabled: false,
    configured: false,
    source: "none" as "none" | "env" | "db",
  });
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    fetchServers();
    fetchTelegramConfig();
    fetchAppSettings();
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

  const fetchTelegramConfig = async () => {
    try {
      const res = await fetch("/api/notifications/telegram");
      if (res.ok) {
        const data = await res.json();
        setTelegramConfig({
          botToken: data.botToken || "",
          chatId: data.chatId || "",
          enabled: data.enabled,
          configured: data.configured,
          source: data.source,
        });
      }
    } catch (error) {
      console.error("Error fetching Telegram config:", error);
    }
  };

  const fetchAppSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.session_retention_days) {
          setSessionRetentionDays(data.session_retention_days);
        }
      }
    } catch (error) {
      console.error("Error fetching app settings:", error);
    }
  };

  const saveSessionRetention = async () => {
    setSessionRetentionSaving(true);
    setSessionRetentionSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_retention_days: sessionRetentionDays || "",
        }),
      });
      if (res.ok) {
        setSessionRetentionSaved(true);
        setTimeout(() => setSessionRetentionSaved(false), 2000);
      }
    } catch (error) {
      console.error("Error saving session retention:", error);
    }
    setSessionRetentionSaving(false);
  };

  const saveTelegramConfig = async () => {
    setTelegramSaving(true);
    try {
      const res = await fetch("/api/notifications/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken: telegramConfig.botToken,
          chatId: telegramConfig.chatId,
          enabled: true,
        }),
      });
      if (res.ok) {
        fetchTelegramConfig();
      }
    } catch (error) {
      console.error("Error saving Telegram config:", error);
    }
    setTelegramSaving(false);
  };

  const testTelegram = async () => {
    setTelegramTesting(true);
    setTelegramTestResult(null);
    try {
      const res = await fetch("/api/notifications/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken: telegramConfig.botToken,
          chatId: telegramConfig.chatId,
        }),
      });
      const result = await res.json();
      setTelegramTestResult(result);
    } catch {
      setTelegramTestResult({ success: false, error: "Network error" });
    }
    setTelegramTesting(false);
  };

  const removeTelegramConfig = async () => {
    try {
      await fetch("/api/notifications/telegram", { method: "DELETE" });
      setTelegramConfig({
        botToken: "",
        chatId: "",
        enabled: false,
        configured: false,
        source: process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN ? "env" : "none",
      });
      setTelegramTestResult(null);
    } catch (error) {
      console.error("Error removing Telegram config:", error);
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
    <div className="flex-1 overflow-y-auto px-8 lg:px-16 py-8">
      <div className="space-y-8">
        <div className="animate-fade-in">
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure MCP servers and LLM preferences
          </p>
        </div>

        {/* Active Servers */}
        {servers.length > 0 && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>Active Servers</CardTitle>
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
            <CardTitle>Add Server</CardTitle>
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
                        installed
                          ? "cursor-default border-border/50 opacity-40"
                          : isConfiguring
                            ? "border-accent/30 bg-accent-glow"
                            : "border-border hover:border-border-hover hover:bg-surface-hover"
                      }`}
                    >
                      <div
                        className={`mt-0.5 ${
                          installed
                            ? "text-muted"
                            : isConfiguring
                              ? "text-accent"
                              : "text-muted-foreground"
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
                <span>Custom server</span>
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

        {/* Telegram Notifications */}
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Send className="h-4.5 w-4.5 text-muted-foreground" />
              <div>
                <span className="text-sm font-medium text-foreground">Telegram</span>
                <p className="text-[12px] text-muted">
                  Send a summary when conversations complete
                </p>
              </div>
            </div>

            {telegramConfig.source === "env" && !telegramConfig.configured && (
              <div className="rounded-lg bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
                Using environment variables. Add config below to override.
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                  Bot Token
                </label>
                <input
                  type="password"
                  placeholder="123456:ABC-DEF..."
                  value={telegramConfig.botToken}
                  onChange={(e) =>
                    setTelegramConfig({ ...telegramConfig, botToken: e.target.value })
                  }
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                  Chat ID
                </label>
                <input
                  type="text"
                  placeholder="-1001234567890"
                  value={telegramConfig.chatId}
                  onChange={(e) =>
                    setTelegramConfig({ ...telegramConfig, chatId: e.target.value })
                  }
                  className={inputClasses}
                />
              </div>

              {telegramTestResult && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${
                    telegramTestResult.success
                      ? "bg-green/10 text-green"
                      : "bg-red/10 text-red"
                  }`}
                >
                  {telegramTestResult.success
                    ? "Test message sent successfully"
                    : `Error: ${telegramTestResult.error}`}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="accent"
                  onClick={saveTelegramConfig}
                  disabled={!telegramConfig.botToken || !telegramConfig.chatId || telegramSaving}
                >
                  {telegramSaving ? "Saving..." : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={testTelegram}
                  disabled={!telegramConfig.botToken || !telegramConfig.chatId || telegramTesting}
                >
                  {telegramTesting ? "Testing..." : "Test"}
                </Button>
                {telegramConfig.configured && (
                  <Button size="sm" variant="ghost" onClick={removeTelegramConfig}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Session Retention */}
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Session Retention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Automatically delete sessions older than the specified number of days.
              Leave empty to keep sessions forever.
            </p>
            <div>
              <label className="mb-1 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                Retention Period (days)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 7"
                  value={sessionRetentionDays}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || (parseInt(v, 10) >= 1 && !v.includes("."))) {
                      setSessionRetentionDays(v);
                    }
                  }}
                  className={`${inputClasses} max-w-[140px]`}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={saveSessionRetention}
                    disabled={sessionRetentionSaving}
                  >
                    {sessionRetentionSaving ? "Saving..." : "Save"}
                  </Button>
                  {sessionRetentionDays && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        setSessionRetentionDays("");
                        setSessionRetentionSaving(true);
                        try {
                          await fetch("/api/settings", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ session_retention_days: "" }),
                          });
                          setSessionRetentionSaved(true);
                          setTimeout(() => setSessionRetentionSaved(false), 2000);
                        } catch (error) {
                          console.error("Error clearing retention:", error);
                        }
                        setSessionRetentionSaving(false);
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              {sessionRetentionSaved && (
                <p className="mt-2 text-xs text-green">
                  Session retention setting saved
                </p>
              )}
              {sessionRetentionDays && (
                <p className="mt-2 text-xs text-muted">
                  Sessions older than {sessionRetentionDays} day{sessionRetentionDays !== "1" ? "s" : ""} will be automatically removed
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* LLM Config info */}
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>LLM Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Set your preferred LLM by adding API keys to your{" "}
              <code className="rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-[12px] text-accent">
                .env.local
              </code>{" "}
              file:
            </p>
            <div className="mt-3 space-y-1 rounded-lg bg-background p-3.5 font-mono text-[13px] text-muted-foreground">
              <div>
                <span className="text-accent">GEMINI_API_KEY</span>
                <span className="text-muted">=your-key-here</span>
              </div>
              <div>
                <span className="text-accent">OPENAI_API_KEY</span>
                <span className="text-muted">=your-key-here</span>
              </div>
              <div>
                <span className="text-accent">ANTHROPIC_API_KEY</span>
                <span className="text-muted">=your-key-here</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              Dobby defaults to Gemini. Configure the default provider in the
              database&apos;s llm_configs table.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
