CREATE TABLE `login_failures` (
	`email_hash` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
