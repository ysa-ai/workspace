ALTER TABLE "user_project_credential_preferences" ADD COLUMN "ai_configs" text;
--> statement-breakpoint
ALTER TABLE "user_project_settings" ADD COLUMN "container_memory" text;
--> statement-breakpoint
ALTER TABLE "user_project_settings" ADD COLUMN "container_cpus" integer;
--> statement-breakpoint
ALTER TABLE "user_project_settings" ADD COLUMN "container_pids_limit" integer;
--> statement-breakpoint
ALTER TABLE "user_project_settings" ADD COLUMN "container_timeout" integer;
