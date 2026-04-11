CREATE TABLE "user_project_settings" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" TEXT NOT NULL REFERENCES "projects"("project_id") ON DELETE CASCADE,
  "project_root" TEXT,
  "worktree_prefix" TEXT,
  "npmrc_path" TEXT,
  "env_vars" TEXT,
  "mcp_config" TEXT,
  "issue_source_token" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_project_settings_user_project_unique" ON "user_project_settings" ("user_id", "project_id");
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "issue_source_token" TEXT;
--> statement-breakpoint
INSERT INTO "user_project_settings" ("user_id", "project_id", "project_root", "worktree_prefix", "npmrc_path", "env_vars", "mcp_config", "issue_source_token")
SELECT om.user_id, p.project_id, p.project_root, p.worktree_prefix, p.npmrc_path, p.env_vars, p.mcp_config, p.issue_source_token
FROM "projects" p
JOIN "org_members" om ON om.org_id = p.org_id;
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "project_root";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "worktree_prefix";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "npmrc_path";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "env_vars";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "mcp_config";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "issue_source_token";
--> statement-breakpoint
ALTER TABLE "user_project_settings" ADD COLUMN "llm_api_key" TEXT;
