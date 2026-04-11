ALTER TABLE sessions ADD COLUMN org_id integer REFERENCES organizations(id);
--> statement-breakpoint
UPDATE sessions SET org_id = (
  SELECT org_id FROM org_members WHERE user_id = sessions.user_id ORDER BY id LIMIT 1
);
