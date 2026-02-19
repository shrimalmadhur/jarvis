export interface AgentConfig {
  name: string;
  enabled: boolean;
  schedule: string; // cron expression
  timezone?: string;
  llm?: {
    provider?: "gemini" | "openai" | "anthropic";
    model?: string;
    temperature?: number;
  };
  maxTokens?: number;
}

export interface AgentDefinition {
  config: AgentConfig;
  soul: string; // contents of soul.md
  skill: string; // contents of skill.md
  directory: string; // absolute path to agent folder
}

export interface RunResult {
  agentName: string;
  success: boolean;
  output: string;
  model: string;
  tokensUsed: { prompt: number; completion: number };
  durationMs: number;
  error?: string;
}
