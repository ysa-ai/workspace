DROP TABLE IF EXISTS "user_credentials";
--> statement-breakpoint
ALTER TABLE "user_project_credential_preferences" DROP COLUMN IF EXISTS "issue_source_credential_name";
