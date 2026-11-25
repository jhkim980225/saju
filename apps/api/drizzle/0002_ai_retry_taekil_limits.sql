ALTER TABLE `tarot_readings` ADD `ai_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tarot_readings` ADD `ai_retry_at` integer;--> statement-breakpoint
CREATE INDEX `reports_user_type_created_idx` ON `reports` (`user_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_taekil_key_idx` ON `reports` (`user_id`,json_extract("content", '$.key'));