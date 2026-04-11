DELETE FROM workflow_steps
WHERE id NOT IN (
  SELECT MIN(id)
  FROM workflow_steps
  GROUP BY workflow_id, slug
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workflow_steps_workflow_slug_unique ON workflow_steps (workflow_id, slug);
