CREATE TABLE `tarot_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text,
	`spread` text NOT NULL,
	`topic` text,
	`question` text,
	`question_key` text NOT NULL,
	`date_key` text NOT NULL,
	`cards` text NOT NULL,
	`deck_fingerprint` text,
	`ai_paragraphs` text,
	`model` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tarot_readings_user_idx` ON `tarot_readings` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tarot_readings_question_uq` ON `tarot_readings` (`user_id`,`date_key`,`question_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `tarot_readings_deck_uq` ON `tarot_readings` (`deck_fingerprint`);