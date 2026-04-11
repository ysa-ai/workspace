CREATE TABLE "tool_presets" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "tools" TEXT NOT NULL,
  "is_builtin" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflows" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
  "id" SERIAL PRIMARY KEY,
  "workflow_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "prompt_template" TEXT NOT NULL DEFAULT '',
  "tool_preset" TEXT NOT NULL DEFAULT 'readonly',
  "tool_allowlist" TEXT,
  "container_mode" TEXT NOT NULL DEFAULT 'readonly',
  "modules" TEXT NOT NULL DEFAULT '[]',
  "network_policy" TEXT,
  "auto_advance" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_transitions" (
  "id" SERIAL PRIMARY KEY,
  "from_step_id" INTEGER NOT NULL,
  "to_step_id" INTEGER,
  "label" TEXT,
  "condition" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "issue_workflow_states" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL UNIQUE,
  "workflow_id" INTEGER NOT NULL,
  "current_step_id" INTEGER,
  "workflow_snapshot" TEXT NOT NULL DEFAULT '{}',
  "step_history" TEXT NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "step_results" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL,
  "step_id" INTEGER NOT NULL,
  "result_type" TEXT NOT NULL,
  "content" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "step_results_issue_step_unique" ON "step_results" ("issue_id", "step_id");
--> statement-breakpoint
CREATE TABLE "step_module_data" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL,
  "step_id" INTEGER NOT NULL,
  "module" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "step_module_data_issue_step_module_unique" ON "step_module_data" ("issue_id", "step_id", "module");
--> statement-breakpoint
CREATE TABLE "projects" (
  "id" SERIAL PRIMARY KEY,
  "project_id" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "project_root" TEXT NOT NULL,
  "worktree_prefix" TEXT NOT NULL,
  "branch_prefix" TEXT NOT NULL DEFAULT 'fix/',
  "default_branch" TEXT NOT NULL DEFAULT 'main',
  "issue_url_template" TEXT NOT NULL DEFAULT '',
  "mcp_config" TEXT,
  "env_vars" TEXT,
  "container_memory" TEXT NOT NULL DEFAULT '4g',
  "container_cpus" INTEGER NOT NULL DEFAULT 2,
  "container_pids_limit" INTEGER NOT NULL DEFAULT 512,
  "container_timeout" INTEGER NOT NULL DEFAULT 3600,
  "llm_provider" TEXT NOT NULL DEFAULT 'claude',
  "llm_max_turns" INTEGER NOT NULL DEFAULT 60,
  "llm_allowed_tools" TEXT,
  "llm_model" TEXT,
  "network_policy" TEXT NOT NULL DEFAULT 'none',
  "issue_source" TEXT NOT NULL DEFAULT 'gitlab',
  "issue_source_token" TEXT,
  "code_repo_url" TEXT,
  "npmrc_path" TEXT,
  "worktree_files" TEXT,
  "languages" TEXT,
  "install_cmd" TEXT,
  "build_cmd" TEXT,
  "pre_dev_cmd" TEXT,
  "dev_servers" TEXT,
  "qa_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "test_cmd" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "workflow_id" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_llm_keys" (
  "id" SERIAL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "api_key" TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_peaks" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "peak_mb" INTEGER NOT NULL,
  "project_id" TEXT,
  "recorded_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "issues" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL UNIQUE,
  "project_id" TEXT,
  "phase" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "session_id" TEXT,
  "pid" INTEGER,
  "plan_summary" TEXT,
  "mr_url" TEXT,
  "error" TEXT,
  "failure_reason" TEXT,
  "issue_url" TEXT,
  "started_at" TIMESTAMP,
  "finished_at" TIMESTAMP,
  "phase_timings" TEXT,
  "workflow_id" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "plans" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL UNIQUE REFERENCES "issues" ("issue_id"),
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "qa_criteria" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL UNIQUE REFERENCES "issues" ("issue_id"),
  "data" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "phase_prompts" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL REFERENCES "issues" ("issue_id"),
  "phase" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "results" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL UNIQUE REFERENCES "issues" ("issue_id"),
  "data" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "finalize_results" (
  "id" SERIAL PRIMARY KEY,
  "issue_id" INTEGER NOT NULL UNIQUE REFERENCES "issues" ("issue_id"),
  "data" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);
