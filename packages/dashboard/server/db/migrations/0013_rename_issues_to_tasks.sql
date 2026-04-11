-- Rename tables
ALTER TABLE issues RENAME TO tasks;
ALTER TABLE issue_workflow_states RENAME TO task_workflow_states;

-- Rename issue_id → task_id in all tables
ALTER TABLE tasks RENAME COLUMN issue_id TO task_id;
ALTER TABLE plans RENAME COLUMN issue_id TO task_id;
ALTER TABLE qa_criteria RENAME COLUMN issue_id TO task_id;
ALTER TABLE phase_prompts RENAME COLUMN issue_id TO task_id;
ALTER TABLE results RENAME COLUMN issue_id TO task_id;
ALTER TABLE finalize_results RENAME COLUMN issue_id TO task_id;
ALTER TABLE task_workflow_states RENAME COLUMN issue_id TO task_id;
ALTER TABLE step_results RENAME COLUMN issue_id TO task_id;
ALTER TABLE step_module_data RENAME COLUMN issue_id TO task_id;
ALTER TABLE submit_tokens RENAME COLUMN issue_id TO task_id;

-- Add source_type and title to tasks
ALTER TABLE tasks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'provider';
ALTER TABLE tasks ADD COLUMN title TEXT;

-- Rename unique indexes (conditional — names vary depending on how the DB was set up)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'step_results_issue_step_unique') THEN
    ALTER INDEX step_results_issue_step_unique RENAME TO step_results_task_step_unique;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'step_module_data_issue_step_module_unique') THEN
    ALTER INDEX step_module_data_issue_step_module_unique RENAME TO step_module_data_task_step_module_unique;
  END IF;
END $$;
