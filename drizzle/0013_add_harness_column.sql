ALTER TABLE `agents` ADD `harness` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `harness` text DEFAULT 'claude';
