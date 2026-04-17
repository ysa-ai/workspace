import { pgTable, text, integer, boolean, timestamp, serial, uniqueIndex } from "drizzle-orm/pg-core";

export const toolPresets = pgTable("tool_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  tools: text("tools").notNull(),
  is_builtin: boolean("is_builtin").notNull().default(false),
  org_id: integer("org_id").references(() => organizations.id),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  is_builtin: boolean("is_builtin").notNull().default(false),
  org_id: integer("org_id").references(() => organizations.id),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const workflowSteps = pgTable("workflow_steps", {
  id: serial("id").primaryKey(),
  workflow_id: integer("workflow_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  position: integer("position").notNull(),
  prompt_template: text("prompt_template").notNull().default(""),
  tool_preset: text("tool_preset").notNull().default("readonly"),
  tool_allowlist: text("tool_allowlist"),
  container_mode: text("container_mode").notNull().default("readonly"),
  modules: text("modules").notNull().default("[]"),
  network_policy: text("network_policy"),
  auto_advance: boolean("auto_advance").notNull().default(false),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const workflowTransitions = pgTable("workflow_transitions", {
  id: serial("id").primaryKey(),
  from_step_id: integer("from_step_id").notNull(),
  to_step_id: integer("to_step_id"),
  label: text("label"),
  condition: text("condition"),
  is_default: boolean("is_default").notNull().default(false),
  position: integer("position").notNull().default(0),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const taskWorkflowStates = pgTable("task_workflow_states", {
  id: serial("id").primaryKey(),
  task_id: integer("task_id").notNull().unique(),
  workflow_id: integer("workflow_id").notNull(),
  current_step_id: integer("current_step_id"),
  workflow_snapshot: text("workflow_snapshot").notNull().default("{}"),
  step_history: text("step_history").notNull().default("[]"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const stepResults = pgTable("step_results", {
  id: serial("id").primaryKey(),
  task_id: integer("task_id").notNull(),
  step_id: integer("step_id").notNull(),
  result_type: text("result_type").notNull(),
  content: text("content"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  uniq: uniqueIndex("step_results_task_step_unique").on(table.task_id, table.step_id),
}));

export const stepModuleData = pgTable("step_module_data", {
  id: serial("id").primaryKey(),
  task_id: integer("task_id").notNull(),
  step_id: integer("step_id").notNull(),
  module: text("module").notNull(),
  data: text("data").notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  uniq: uniqueIndex("step_module_data_task_step_module_unique").on(table.task_id, table.step_id, table.module),
}));

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  project_id: text("project_id").notNull().unique(),
  name: text("name").notNull(),
  branch_prefix: text("branch_prefix").notNull().default("fix/"),
  default_branch: text("default_branch").notNull().default("main"),
  issue_url_template: text("issue_url_template").notNull().default(""),
  container_memory: text("container_memory").notNull().default("4g"),
  container_cpus: integer("container_cpus").notNull().default(2),
  container_pids_limit: integer("container_pids_limit").notNull().default(512),
  container_timeout: integer("container_timeout").notNull().default(3600),
  llm_provider: text("llm_provider").notNull().default("claude"),
  llm_max_turns: integer("llm_max_turns").notNull().default(60),
  llm_allowed_tools: text("llm_allowed_tools"),
  llm_model: text("llm_model"),
  network_policy: text("network_policy").notNull().default("none"),
  issue_source: text("issue_source").notNull().default("gitlab"),
  code_repo_url: text("code_repo_url"),
  gitlab_project_id: integer("gitlab_project_id"),
  deps_cache_files: text("deps_cache_files"),
  worktree_files: text("worktree_files"),
  languages: text("languages"),
  install_cmd: text("install_cmd"),
  build_cmd: text("build_cmd"),
  pre_dev_cmd: text("pre_dev_cmd"),
  dev_servers: text("dev_servers"),
  qa_enabled: boolean("qa_enabled").notNull().default(false),
  test_cmd: text("test_cmd"),
  issue_source_token: text("issue_source_token"),
  is_default: boolean("is_default").notNull().default(false),
  workflow_id: integer("workflow_id"),
  org_id: integer("org_id").references(() => organizations.id).notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const userProjectCredentialPreferences = pgTable("user_project_credential_preferences", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  project_id: text("project_id").notNull().references(() => projects.project_id, { onDelete: "cascade" }),
  default_credential_name: text("default_credential_name"),
  ai_configs: text("ai_configs"),
  phase_overrides: text("phase_overrides"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  uniq: uniqueIndex("user_project_cred_prefs_unique").on(table.user_id, table.project_id),
}));

export const containerPeaks = pgTable("container_peaks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  peak_mb: integer("peak_mb").notNull(),
  project_id: text("project_id"),
  recorded_at: timestamp("recorded_at", { mode: "string" }).notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  task_id: integer("task_id").notNull().unique(),
  project_id: text("project_id"),
  step: text("step").notNull(),
  status: text("status").notNull(),
  session_id: text("session_id"),
  pid: integer("pid"),
  plan_summary: text("plan_summary"),
  mr_url: text("mr_url"),
  error: text("error"),
  failure_reason: text("failure_reason"),
  issue_url: text("issue_url"),
  started_at: timestamp("started_at", { mode: "string" }),
  finished_at: timestamp("finished_at", { mode: "string" }),
  phase_timings: text("phase_timings"),
  deps_cache_volumes: text("deps_cache_volumes"),
  workflow_id: integer("workflow_id"),
  source_type: text("source_type").notNull().default("provider"),
  network_policy: text("network_policy"),
  title: text("title"),
  prompt: text("prompt"),
  created_by: integer("created_by").references(() => users.id),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const stepPrompts = pgTable("step_prompts", {
  id: serial("id").primaryKey(),
  task_id: integer("task_id").notNull().references(() => tasks.task_id),
  step_slug: text("step_slug").notNull(),
  content: text("content").notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash"),
  google_id: text("google_id").unique(),
  tos_accepted_at: timestamp("tos_accepted_at", { mode: "string" }),
  email_verified_at: timestamp("email_verified_at", { mode: "string" }),
  onboarding_step: integer("onboarding_step").notNull().default(0),
  onboarding_completed_at: text("onboarding_completed_at"),
  onboarding_role: text("onboarding_role"),
  onboarding_team_size: text("onboarding_team_size"),
  onboarding_use_case: text("onboarding_use_case"),
  force_password_reset: boolean("force_password_reset").notNull().default(false),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
});

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token_hash: text("token_hash").notNull().unique(),
  expires_at: timestamp("expires_at", { mode: "string" }).notNull(),
  used_at: timestamp("used_at", { mode: "string" }),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token_hash: text("token_hash").notNull().unique(),
  expires_at: timestamp("expires_at", { mode: "string" }).notNull(),
  used_at: timestamp("used_at", { mode: "string" }),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const emailChangeTokens = pgTable("email_change_tokens", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  new_email: text("new_email").notNull(),
  token_hash: text("token_hash").notNull().unique(),
  expires_at: timestamp("expires_at", { mode: "string" }).notNull(),
  used_at: timestamp("used_at", { mode: "string" }),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const orgMembers = pgTable("org_members", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  org_id: integer("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  uniq: uniqueIndex("org_members_user_org_unique").on(table.user_id, table.org_id),
}));

export const orgInvitations = pgTable("org_invitations", {
  id: serial("id").primaryKey(),
  org_id: integer("org_id").notNull().references(() => organizations.id),
  role: text("role").notNull().default("member"),
  token: text("token").notNull().unique(),
  invited_by: integer("invited_by").references(() => users.id),
  expires_at: timestamp("expires_at", { mode: "string" }).notNull(),
  used_at: timestamp("used_at", { mode: "string" }),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  org_id: integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  token_hash: text("token_hash").notNull().unique(),
  expires_at: timestamp("expires_at", { mode: "string" }).notNull(),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});

export const userProjectSettings = pgTable("user_project_settings", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  project_id: text("project_id").notNull().references(() => projects.project_id, { onDelete: "cascade" }),
  project_root: text("project_root"),
  worktree_prefix: text("worktree_prefix"),
  npmrc_path: text("npmrc_path"),
  env_vars: text("env_vars"),
  mcp_config: text("mcp_config"),
  issue_source_token: text("issue_source_token"),
  code_repo_token: text("code_repo_token"),
  container_memory: text("container_memory"),
  container_cpus: integer("container_cpus"),
  container_pids_limit: integer("container_pids_limit"),
  container_timeout: integer("container_timeout"),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  uniq: uniqueIndex("user_project_settings_user_project_unique").on(table.user_id, table.project_id),
}));

export const submitTokens = pgTable("submit_tokens", {
  id: serial("id").primaryKey(),
  task_id: integer("task_id").notNull(),
  project_id: text("project_id").notNull(),
  phase: text("phase").notNull(),
  token_hash: text("token_hash").notNull().unique(),
  expires_at: integer("expires_at").notNull(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const deviceAuthCodes = pgTable("device_auth_codes", {
  id: serial("id").primaryKey(),
  device_code: text("device_code").notNull().unique(),
  user_code: text("user_code").notNull().unique(),
  user_id: integer("user_id").references(() => users.id),
  org_id: integer("org_id").references(() => organizations.id),
  expires_at: timestamp("expires_at", { mode: "string" }).notNull(),
  used_at: timestamp("used_at", { mode: "string" }),
  created_at: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});
