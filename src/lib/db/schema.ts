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

// ── Agent Runs ────────────────────────────────────────────────

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentName: text("agent_name").notNull(),
  status: text("status").notNull(), // 'success' | 'error'
  output: text("output"),
  model: text("model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});
