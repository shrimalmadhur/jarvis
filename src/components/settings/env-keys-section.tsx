"use client";

import { useEffect, useState } from "react";
import { Key, Eye, EyeOff, Trash2, Plus, X, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { settingsInputClasses as inputClasses } from "@/components/shared/form-classes";

export function EnvKeysSection() {
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
    fetchEnvKeys();
  }, []);

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

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-4 w-4" />
          API Keys
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
              Manage your API keys from the environment file at{" "}
              <code className="rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-[12px] text-accent">
                /etc/dobby/env
              </code>
            </p>
            <div className="space-y-3">
              {(() => {
                const knownLabels: Record<string, string> = {
                  GEMINI_API_KEY: "Gemini (default)",
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
                Setting saved. Restart Dobby to apply changes.
              </div>
            )}

            <p className="text-xs text-muted">
              Dobby&apos;s default provider is Gemini. Changes require a restart to take effect.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
