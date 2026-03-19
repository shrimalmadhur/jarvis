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
  X,
  Check,
  Clock,
  Eye,
  EyeOff,
  Wand2,
  Loader2,
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

  // Wand Core (env file) state
  const [envKeys, setEnvKeys] = useState<Record<string, { set: boolean; masked: string; value?: string }>>({});
  const [envExists, setEnvExists] = useState(false);
  const [envEditing, setEnvEditing] = useState<Record<string, string>>({});
  const [envSaving, setEnvSaving] = useState(false);
  const [envSaved, setEnvSaved] = useState(false);
  const [envRevealed, setEnvRevealed] = useState<Record<string, boolean>>({});
  const [showAddKey, setShowAddKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [newKeyError, setNewKeyError] = useState<string | null>(null);

  useEffect(() => {
    fetchServers();
    fetchAppSettings();
    fetchEnvKeys();
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

  const fetchEnvKeys = async () => {
    try {
      const res = await fetch("/api/settings/env");
      if (res.ok) {
        const data = await res.json();
        setEnvExists(data.exists);
        setEnvKeys(data.keys || {});
      }
    } catch (error) {
      console.error("Error fetching env keys:", error);
    }
  };

  const revealEnvKey = async (key: string) => {
    if (envRevealed[key]) {
      // Toggle off — just hide it
      setEnvRevealed({ ...envRevealed, [key]: false });
      return;
    }
    try {
      const res = await fetch(`/api/settings/env?unmask=${key}`);
      if (res.ok) {
        const data = await res.json();
        const keyData = data.keys?.[key];
        if (keyData?.value) {
          setEnvKeys((prev) => ({
            ...prev,
            [key]: { ...prev[key], value: keyData.value },
          }));
          setEnvRevealed({ ...envRevealed, [key]: true });
        }
      }
    } catch (error) {
      console.error("Error revealing key:", error);
    }
  };

  const saveEnvKeys = async () => {
    // Only send keys where the user actually typed a value
    const dirty = Object.fromEntries(
      Object.entries(envEditing).filter(([, v]) => v.length > 0)
    );
    if (Object.keys(dirty).length === 0) return;
    setEnvSaving(true);
    setEnvSaved(false);
    try {
      const res = await fetch("/api/settings/env", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirty),
      });
      if (res.ok) {
        setEnvSaved(true);
        setEnvEditing({});
        setEnvRevealed({});
        fetchEnvKeys();
        setTimeout(() => setEnvSaved(false), 3000);
      }
    } catch (error) {
      console.error("Error saving env keys:", error);
    }
    setEnvSaving(false);
  };

  const addCustomKey = async () => {
    const key = newKeyName.trim().toUpperCase();
    if (!key) return;
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      setNewKeyError("Use UPPER_SNAKE_CASE (e.g. MY_API_KEY)");
      return;
    }
    if (!newKeyValue.trim()) {
      setNewKeyError("Value is required");
      return;
    }
    setNewKeyError(null);
    setEnvSaving(true);
    try {
      const res = await fetch("/api/settings/env", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: newKeyValue }),
      });
      if (res.ok) {
        setNewKeyName("");
        setNewKeyValue("");
        setShowAddKey(false);
        setEnvSaved(true);
        fetchEnvKeys();
        setTimeout(() => setEnvSaved(false), 3000);
      } else {
        const data = await res.json();
        setNewKeyError(data.error || "Failed to add key");
      }
    } catch {
      setNewKeyError("Failed to add key");
    }
    setEnvSaving(false);
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
          <h1 className="text-xl font-semibold text-foreground">Room of Requirement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure Dobby&apos;s magical connections and enchantments
          </p>
        </div>

        {/* Active Servers */}
        {servers.length > 0 && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>Active Enchantments</CardTitle>
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
            <CardTitle>Enchantment Library</CardTitle>
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
                <span>Custom enchantment</span>
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

        {/* Session Retention */}
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pensieve Retention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Memories older than the specified days will fade from the Pensieve.
              Leave empty to preserve all memories forever.
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
                  Pensieve retention enchantment saved
                </p>
              )}
              {sessionRetentionDays && (
                <p className="mt-2 text-xs text-muted">
                  Memories older than {sessionRetentionDays} day{sessionRetentionDays !== "1" ? "s" : ""} will fade from the Pensieve
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Wand Core Selection - live env editor */}
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" />
              Wand Core Selection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!envExists ? (
              <div className="rounded-lg bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
                Env file not found at <code className="text-accent">/etc/dobby/env</code>.
                Run <code className="text-accent">make install</code> to set up Dobby as a service.
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Manage your wand cores from the enchanted scroll at{" "}
                  <code className="rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-[12px] text-accent">
                    /etc/dobby/env
                  </code>
                </p>
                <div className="space-y-3">
                  {(() => {
                    const knownLabels: Record<string, string> = {
                      GEMINI_API_KEY: "Gemini (default wand core)",
                      OPENAI_API_KEY: "OpenAI",
                      ANTHROPIC_API_KEY: "Anthropic",
                    };
                    // Show known keys first (even if not set), then any extra keys from env
                    const knownKeys = ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
                    const extraKeys = Object.keys(envKeys).filter(k => !knownKeys.includes(k)).sort();
                    const allKeys = [...knownKeys, ...extraKeys];

                    return allKeys.map((key) => {
                      const info = envKeys[key];
                      const label = knownLabels[key] || key;
                      const isEditing = key in envEditing;
                      const isRevealed = envRevealed[key] || false;

                      const displayValue = isEditing
                        ? envEditing[key]
                        : isRevealed && info?.value
                          ? info.value
                          : "";

                      return (
                        <div key={key} className="rounded-lg border border-border px-4 py-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-foreground">{label}</span>
                            <span className={`text-[12px] font-mono ${info?.set ? "text-green" : "text-muted"}`}>
                              {info?.set ? "configured" : "not set"}
                            </span>
                          </div>
                          {!isEditing && !isRevealed && info?.set && (
                            <div className="font-mono text-[13px] text-muted-foreground mb-2">
                              {info.masked}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <input
                                type={isRevealed || isEditing ? "text" : "password"}
                                placeholder={info?.set ? "enter new value to update" : "enter value"}
                                value={displayValue}
                                onChange={(e) =>
                                  setEnvEditing({ ...envEditing, [key]: e.target.value })
                                }
                                className={inputClasses}
                              />
                            </div>
                            {info?.set && (
                              <button
                                onClick={() => revealEnvKey(key)}
                                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                                title={isRevealed ? "Hide" : "Reveal"}
                              >
                                {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            )}
                            {info?.set && !isEditing && (
                              <button
                                onClick={async () => {
                                  try {
                                    const res = await fetch("/api/settings/env", {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ [key]: "" }),
                                    });
                                    if (res.ok) {
                                      setEnvSaved(true);
                                      setEnvRevealed({});
                                      fetchEnvKeys();
                                      setTimeout(() => setEnvSaved(false), 3000);
                                    }
                                  } catch (err) {
                                    console.error("Error deleting key:", err);
                                  }
                                }}
                                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-red"
                                title="Remove"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {isEditing && (
                              <button
                                onClick={() => {
                                  const next = { ...envEditing };
                                  delete next[key];
                                  setEnvEditing(next);
                                }}
                                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                                title="Cancel"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Save button for inline edits */}
                {Object.values(envEditing).some(v => v.length > 0) && (
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="accent"
                      onClick={saveEnvKeys}
                      disabled={envSaving}
                    >
                      {envSaving ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Saving...
                        </span>
                      ) : "Save Changes"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEnvEditing({})}
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {/* Add custom key */}
                <div className="border-t border-border pt-4">
                  {showAddKey ? (
                    <div className="animate-fade-in space-y-3 rounded-lg border border-border p-4">
                      <div>
                        <label className="mb-1 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                          Key Name
                        </label>
                        <input
                          type="text"
                          placeholder="MY_CUSTOM_KEY"
                          value={newKeyName}
                          onChange={(e) => { setNewKeyName(e.target.value.toUpperCase()); setNewKeyError(null); }}
                          className={inputClasses}
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                          Value
                        </label>
                        <input
                          type="text"
                          placeholder="secret-value-here"
                          value={newKeyValue}
                          onChange={(e) => { setNewKeyValue(e.target.value); setNewKeyError(null); }}
                          className={inputClasses}
                        />
                      </div>
                      {newKeyError && (
                        <p className="text-xs text-red">{newKeyError}</p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="accent" onClick={addCustomKey} disabled={envSaving}>
                          Add
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowAddKey(false); setNewKeyName(""); setNewKeyValue(""); setNewKeyError(null); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddKey(true)}
                      className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add custom env variable</span>
                    </button>
                  )}
                </div>

                {envSaved && (
                  <div className="rounded-lg bg-green/10 px-3 py-2 text-xs text-green">
                    Enchantment saved. Restart Dobby to apply changes.
                  </div>
                )}

                <p className="text-xs text-muted">
                  Dobby&apos;s default wand core is Gemini. Changes require a restart to take effect.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
