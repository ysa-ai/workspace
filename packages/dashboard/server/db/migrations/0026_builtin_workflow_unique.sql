CREATE UNIQUE INDEX IF NOT EXISTS workflows_builtin_name_unique ON workflows (name) WHERE is_builtin = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workflows_org_name_unique ON workflows (name, org_id) WHERE is_builtin = false;
