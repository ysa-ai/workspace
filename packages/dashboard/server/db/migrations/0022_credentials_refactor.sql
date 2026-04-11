ALTER TABLE "user_project_settings" DROP COLUMN "llm_api_key";
--> statement-breakpoint
DROP TABLE "project_llm_keys";
--> statement-breakpoint
CREATE TABLE "user_project_credential_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("project_id") ON DELETE CASCADE,
  "default_credential_name" text,
  "phase_overrides" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "project_id")
);
