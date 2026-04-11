ALTER TABLE workflows ADD COLUMN is_builtin boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE workflows ALTER COLUMN org_id DROP NOT NULL;
--> statement-breakpoint
UPDATE workflows SET is_builtin = true, org_id = NULL WHERE name = 'Default';
