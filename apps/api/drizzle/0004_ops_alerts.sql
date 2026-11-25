CREATE TABLE `ops_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`note` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `registered_at` integer;--> statement-breakpoint
-- 이미 있는 회원은 가입 시각을 생성 시각으로 채운다(게스트에서 전환한 회원은 전환 시각을 알 수 없어 생성 시각으로 둔다)
UPDATE `users` SET `registered_at` = `created_at` WHERE `provider` <> 'guest' AND `registered_at` IS NULL;
