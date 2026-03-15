import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";

// ── Conversations ──────────────────────────────────────────────

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── Messages ───────────────────────────────────────────────────

export type ToolCallData = {
  id: string;
  name: string;
  arguments: string; // JSON string
};

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(), // 'user' | 'assistant' | 'tool'
  content: text("content"),
  toolCalls: text("tool_calls", { mode: "json" }).$type<ToolCallData[]>(),
  toolCallId: text("tool_call_id"),
  providerData: text("provider_data", { mode: "json" }).$type<unknown[]>(),
  modelUsed: text("model_used"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── Agent Tasks ────────────────────────────────────────────────

export type TaskSchedule = {
  cron?: string;
  runAt?: string;
  repeat?: boolean;
};

export const agentTasks = sqliteTable("agent_tasks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text("conversation_id").references(() => conversations.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  name: text("name").notNull(),
  schedule: text("schedule", { mode: "json" }).$type<TaskSchedule>(),
  toolName: text("tool_name"),
  toolArgs: text("tool_args", { mode: "json" }).$type<Record<string, unknown>>(),
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
  nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── MCP Server Configs ─────────────────────────────────────────

export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  command: text("command").notNull(),
  args: text("args", { mode: "json" }).$type<string[]>().default([]),
  env: text("env", { mode: "json" }).$type<Record<string, string>>().default({}),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── LLM Configs ────────────────────────────────────────────────

export const llmConfigs = sqliteTable("llm_configs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskType: text("task_type").notNull().default("default"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  temperature: real("temperature").default(0.7),
  isDefault: integer("is_default", { mode: "boolean" }).default(false).notNull(),
});

// ── Notification Configs ──────────────────────────────────────

export const notificationConfigs = sqliteTable("notification_configs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  channel: text("channel").notNull(), // 'telegram', etc.
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, string>>().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── Projects ──────────────────────────────────────────────────

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── Agents (DB-managed) ───────────────────────────────────────

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  soul: text("soul").notNull(),
  skill: text("skill").notNull(),
  schedule: text("schedule").notNull(),
  timezone: text("timezone"),
  envVars: text("env_vars", { mode: "json" }).$type<Record<string, string>>().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── Claude Sessions (persisted from ~/.claude/) ──────────────

export const claudeSessions = sqliteTable("claude_sessions", {
  sessionId: text("session_id").primaryKey(),
  projectPath: text("project_path").notNull(),
  projectName: text("project_name").notNull(),
  projectDir: text("project_dir").notNull(),
  workspaceName: text("workspace_name").notNull().default(""),
  slug: text("slug"),
  model: text("model"),
  gitBranch: text("git_branch"),
  status: text("status").notNull().default("completed"), // active | idle | completed
  lastActivity: text("last_activity").notNull(),
  created: text("created"),
  lastAction: text("last_action"),
  lastToolName: text("last_tool_name"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),
  isSubagent: integer("is_subagent", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

export const claudeSessionTimeline = sqliteTable("claude_session_timeline", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => claudeSessions.sessionId, { onDelete: "cascade" }),
  projectDir: text("project_dir").notNull(),
  subagentId: text("subagent_id"), // null for parent session
  timestamp: text("timestamp").notNull(),
  kind: text("kind").notNull(), // user | assistant | tool_use | tool_result | sub_agent | error
  text: text("text").notNull(),
  toolName: text("tool_name"),
  isError: integer("is_error", { mode: "boolean" }).default(false),
  agentId: text("agent_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheCreationTokens: integer("cache_creation_tokens"),
});

export const claudeSessionSubAgents = sqliteTable("claude_session_sub_agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => claudeSessions.sessionId, { onDelete: "cascade" }),
  projectDir: text("project_dir").notNull(),
  agentId: text("agent_id").notNull(),
  prompt: text("prompt"),
  model: text("model"),
  messageCount: integer("message_count").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
});

export const claudeSessionTasks = sqliteTable("claude_session_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => claudeSessions.sessionId, { onDelete: "cascade" }),
  projectDir: text("project_dir").notNull(),
  taskId: text("task_id").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull(),
  activeForm: text("active_form"),
});

// ── Agent Runs ────────────────────────────────────────────────

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentName: text("agent_name").notNull(),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  status: text("status").notNull(), // 'success' | 'error'
  output: text("output"),
  model: text("model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  toolUseCount: integer("tool_use_count").default(0),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

// ── Agent Run Tool Uses ──────────────────────────────────────

export type ToolUseData = {
  name: string;
  input: string; // JSON string of tool input
  output: string; // JSON string of tool output
  isError: boolean;
  durationMs?: number;
};

export const agentRunToolUses = sqliteTable("agent_run_tool_uses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").references(() => agentRuns.id, { onDelete: "cascade" }).notNull(),
  toolName: text("tool_name").notNull(),
  toolInput: text("tool_input"),  // JSON string
  toolOutput: text("tool_output"), // JSON string (truncated if large)
  isError: integer("is_error", { mode: "boolean" }).default(false).notNull(),
  durationMs: integer("duration_ms"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});
