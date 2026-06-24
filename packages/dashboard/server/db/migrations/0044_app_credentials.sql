ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "app_credentials" text;
ALTER TABLE "user_project_settings" ADD COLUMN IF NOT EXISTS "app_credentials" text;
