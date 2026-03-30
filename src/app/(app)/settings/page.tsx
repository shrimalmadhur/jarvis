"use client";

import { getVersion } from "@/lib/version";
import { MCPServersSection } from "@/components/settings/mcp-servers-section";
import { CodingHarnessSection } from "@/components/settings/coding-harness-section";
import { SessionRetentionSection } from "@/components/settings/session-retention-section";
import { EnvKeysSection } from "@/components/settings/env-keys-section";

const version = getVersion();

export default function SettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 lg:px-16 py-8 space-y-8">
        <div className="animate-fade-in">
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure Dobby&apos;s integrations and tools
          </p>
        </div>

        <MCPServersSection />
        <CodingHarnessSection />
        <SessionRetentionSection />
        <EnvKeysSection />

        {/* Version */}
        <div className="mt-8 text-center text-[12px] text-muted-foreground/50 font-mono">
          {version.tag && <span>Version {version.tag}</span>}
          {!version.tag && version.branch && <span>Branch: {version.branch}</span>}
          {version.commit && <span> · {version.commit}</span>}
          {!version.tag && !version.branch && !version.commit && <span>dev</span>}
        </div>
      </div>
    </div>
  );
}
