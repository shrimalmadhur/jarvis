// Types for reading Claude Code local session data from ~/.claude/

export interface ClaudeSessionEntry {
  type: "user" | "assistant" | "progress" | "queue-operation" | "system";
  sessionId: string;
  slug?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  timestamp: string;
  agentId?: string;
  uuid?: string;
  parentUuid?: string | null;
  userType?: "external" | "internal";
  message?: {
    role: string;
    model?: string;
    content?:
      | string
      | Array<{
          type: string;
          text?: string;
          name?: string;
          input?: Record<string, unknown>;
          tool_use_id?: string;
          content?: string;
          is_error?: boolean;
        }>;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
    };
  };
  toolUseResult?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
    isImage?: boolean;
  };
  data?: {
    type?: string;
    agentId?: string;
    prompt?: string;
  };
}

// --- Dashboard list types ---

export interface AgentSession {
  sessionId: string;
  projectPath: string;
  projectName: string;
  projectDir: string;
  workspaceName: string;
  slug: string | null;
  model: string | null;
  gitBranch: string | null;
  status: "active" | "idle" | "completed";
  lastActivity: string;
  lastAction: string | null;
  lastToolName: string | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  messageCount: number;
  isSubagent: boolean;
}

export interface AgentStatusResponse {
  sessions: AgentSession[];
  summary: {
    activeCount: number;
    idleCount: number;
    completedCount: number;
    totalTokensToday: number;
    totalSessionsToday: number;
  };
  scannedAt: string;
}

// --- Session detail types ---

export interface TimelineEntry {
  timestamp: string;
  kind: "user" | "assistant" | "tool_use" | "tool_result" | "sub_agent" | "error";
  text: string;
  toolName?: string;
  isError?: boolean;
  agentId?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

export interface SubAgentInfo {
  agentId: string;
  prompt: string | null;
  model: string | null;
  messageCount: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

export interface TaskInfo {
  id: string;
  subject: string;
  status: string;
  activeForm?: string;
}

export interface SessionDetailResponse {
  session: {
    sessionId: string;
    slug: string | null;
    projectName: string;
    projectPath: string;
    gitBranch: string | null;
    model: string | null;
    status: "active" | "idle" | "completed";
    created: string;
    lastActivity: string;
    totalTokens: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    };
  };
  timeline: TimelineEntry[];
  subAgents: SubAgentInfo[];
  tasks: TaskInfo[];
}
