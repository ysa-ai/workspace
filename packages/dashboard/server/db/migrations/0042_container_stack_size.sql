ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "container_stack_size" integer;
ALTER TABLE "user_project_settings" ADD COLUMN IF NOT EXISTS "container_stack_size" integer;
