DROP TABLE IF EXISTS finalize_results;
--> statement-breakpoint
DROP TABLE IF EXISTS results;
--> statement-breakpoint
DROP TABLE IF EXISTS qa_criteria;
--> statement-breakpoint
DROP TABLE IF EXISTS plans;
--> statement-breakpoint
ALTER TABLE phase_prompts RENAME TO step_prompts;
--> statement-breakpoint
ALTER TABLE step_prompts RENAME COLUMN phase TO step_slug;
--> statement-breakpoint
ALTER TABLE tasks RENAME COLUMN phase TO step;
