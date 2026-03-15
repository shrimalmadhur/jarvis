CREATE TABLE IF NOT EXISTS `agent_run_tool_uses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_input` text,
	`tool_output` text,
	`is_error` integer DEFAULT false NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_name` text NOT NULL,
	`agent_id` text,
	`status` text NOT NULL,
	`output` text,
	`model` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`tool_use_count` integer DEFAULT 0,
	`duration_ms` integer,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`name` text NOT NULL,
	`schedule` text,
	`tool_name` text,
	`tool_args` text,
	`result` text,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`soul` text NOT NULL,
	`skill` text NOT NULL,
	`schedule` text NOT NULL,
	`timezone` text,
	`env_vars` text DEFAULT '{}',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `claude_session_sub_agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`project_dir` text NOT NULL,
	`agent_id` text NOT NULL,
	`prompt` text,
	`model` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `claude_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `claude_session_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`project_dir` text NOT NULL,
	`task_id` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`active_form` text,
	FOREIGN KEY (`session_id`) REFERENCES `claude_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `claude_session_timeline` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`project_dir` text NOT NULL,
	`subagent_id` text,
	`timestamp` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`tool_name` text,
	`is_error` integer DEFAULT false,
	`agent_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	FOREIGN KEY (`session_id`) REFERENCES `claude_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `claude_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`project_name` text NOT NULL,
	`project_dir` text NOT NULL,
	`workspace_name` text DEFAULT '' NOT NULL,
	`slug` text,
	`model` text,
	`git_branch` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`last_activity` text NOT NULL,
	`created` text,
	`last_action` text,
	`last_tool_name` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`is_subagent` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `llm_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_type` text DEFAULT 'default' NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`temperature` real DEFAULT 0.7,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`args` text DEFAULT '[]',
	`env` text DEFAULT '{}',
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text,
	`tool_calls` text,
	`tool_call_id` text,
	`provider_data` text,
	`model_used` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config` text DEFAULT '{}',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `projects_name_unique` ON `projects` (`name`);