export interface AgentConfig {
  name: string;
  enabled: boolean;
  schedule: string; // cron expression
  timezone?: string;
  envVars?: Record<string, string>;
}

export interface AgentDefinition {
  config: AgentConfig;
  soul: string; // contents of soul.md
  skill: string; // contents of skill.md
  directory?: string; // absolute path to agent folder (undefined for DB agents)
  agentId?: string; // DB agent id (undefined for filesystem agents)
}

export interface ToolUseLog {
  toolName: string;
  toolInput?: string;
  toolOutput?: string;
  isError: boolean;
  durationMs?: number;
}

export interface RunResult {
  agentName: string;
  agentId?: string; // set for DB-backed agents
  success: boolean;
  output: string;
  model: string;
  tokensUsed: { prompt: number; completion: number };
  toolUses: ToolUseLog[];
  durationMs: number;
  error?: string;
  claudeSessionId?: string;
  claudeSessionProjectDir?: string;
}
