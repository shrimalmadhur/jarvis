ALTER TABLE `issues` ADD `slack_thread_ts` text;
--> statement-breakpoint
ALTER TABLE `issue_messages` ADD `slack_message_ts` text;
--> statement-breakpoint
CREATE INDEX `idx_issues_slack_thread` ON `issues` (`slack_channel_id`,`slack_thread_ts`);
--> statement-breakpoint
CREATE INDEX `idx_issue_messages_slack_message_ts` ON `issue_messages` (`slack_message_ts`);
