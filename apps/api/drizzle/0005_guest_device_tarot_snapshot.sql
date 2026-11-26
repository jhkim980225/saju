ALTER TABLE `tarot_readings` ADD `saju_snapshot` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_guest_device_uq` ON `users` (`device_id`) WHERE provider = 'guest' AND deleted_at IS NULL;