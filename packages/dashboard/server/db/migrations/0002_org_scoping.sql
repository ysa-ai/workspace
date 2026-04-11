ALTER TABLE projects ADD COLUMN org_id integer REFERENCES organizations(id);
--> statement-breakpoint
UPDATE projects SET org_id = (SELECT id FROM organizations ORDER BY id LIMIT 1) WHERE org_id IS NULL;
--> statement-breakpoint
ALTER TABLE projects ALTER COLUMN org_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE workflows ADD COLUMN org_id integer REFERENCES organizations(id);
--> statement-breakpoint
UPDATE workflows SET org_id = (SELECT id FROM organizations ORDER BY id LIMIT 1) WHERE org_id IS NULL;
--> statement-breakpoint
ALTER TABLE workflows ALTER COLUMN org_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE tool_presets ADD COLUMN org_id integer REFERENCES organizations(id);
--> statement-breakpoint
UPDATE tool_presets SET org_id = (SELECT id FROM organizations ORDER BY id LIMIT 1) WHERE org_id IS NULL AND is_builtin = false;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN created_by integer REFERENCES users(id);
--> statement-breakpoint
UPDATE issues SET created_by = (SELECT user_id FROM org_members ORDER BY id LIMIT 1) WHERE created_by IS NULL;
