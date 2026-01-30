import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  real,
} from "drizzle-orm/pg-core";

// ── Conversations ──────────────────────────────────────────────

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Messages ───────────────────────────────────────────────────

export type ToolCallData = {
  id: string;
  name: string;
  arguments: string; // JSON string
};

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(), // 'user' | 'assistant' | 'tool'
  content: text("content"),
  toolCalls: jsonb("tool_calls").$type<ToolCallData[]>(),
  toolCallId: text("tool_call_id"),
  providerData: jsonb("provider_data").$type<unknown[]>(),
  modelUsed: text("model_used"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Agent Tasks ────────────────────────────────────────────────

export type TaskSchedule = {
  cron?: string;
  runAt?: string;
  repeat?: boolean;
};

export const agentTasks = pgTable("agent_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  name: text("name").notNull(),
  schedule: jsonb("schedule").$type<TaskSchedule>(),
  toolName: text("tool_name"),
  toolArgs: jsonb("tool_args").$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── MCP Server Configs ─────────────────────────────────────────

export const mcpServers = pgTable("mcp_servers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  command: text("command").notNull(),
  args: jsonb("args").$type<string[]>().default([]),
  env: jsonb("env").$type<Record<string, string>>().default({}),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── LLM Configs ────────────────────────────────────────────────

export const llmConfigs = pgTable("llm_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskType: text("task_type").notNull().default("default"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  temperature: real("temperature").default(0.7),
  isDefault: boolean("is_default").default(false).notNull(),
});
