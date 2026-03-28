"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { settingsInputClasses as inputClasses } from "@/components/shared/form-classes";

export function SessionRetentionSection() {
  const [sessionRetentionDays, setSessionRetentionDays] = useState("");
  const [sessionRetentionSaving, setSessionRetentionSaving] = useState(false);
  const [sessionRetentionSaved, setSessionRetentionSaved] = useState(false);

  useEffect(() => {
    fetchAppSettings();
  }, []);

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

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Session Retention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Sessions older than the specified days will be automatically cleaned up.
          Leave empty to preserve all sessions.
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
              Sessions older than {sessionRetentionDays} day{sessionRetentionDays !== "1" ? "s" : ""} will be cleaned up
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
