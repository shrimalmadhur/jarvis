CREATE TABLE `issue_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer,
	`telegram_file_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
