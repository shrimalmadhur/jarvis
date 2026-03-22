CREATE TABLE `issue_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` text NOT NULL,
	`direction` text NOT NULL,
	`message` text NOT NULL,
	`telegram_message_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_phase` integer DEFAULT 0 NOT NULL,
	`telegram_message_id` integer,
	`telegram_chat_id` text,
	`pr_url` text,
	`phase_session_ids` text DEFAULT '{}',
	`plan_output` text,
	`plan_review_1` text,
	`plan_review_2` text,
	`code_review_1` text,
	`code_review_2` text,
	`worktree_path` text,
	`branch_name` text,
	`error` text,
	`locked_at` integer,
	`locked_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`github_repo_url` text,
	`local_repo_path` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_name_unique` ON `repositories` (`name`);