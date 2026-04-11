import { z } from "zod";
import { router, protectedProcedure as publicProcedure } from "./init";
import { db } from "../db";
import { projects, tasks, workflows, userProjectSettings, userProjectCredentialPreferences, userCredentials } from "../db/schema";
import { eq, and, ne, inArray, max } from "drizzle-orm";
import { requireProjectAccess, requireAdminRole } from "../lib/auth-guard";
import { config } from "../config";
import { encrypt, decrypt } from "../lib/crypto";
import { sendCommand, isAgentConnectedForUser } from "../ws/dispatch";
import { pushSyncConfig } from "../ws/handler";
import { startBuild } from "../lib/build-manager";
import { projectImageName, getMiseToolsForLanguages } from "@ysa-ai/ysa/runtime";
import type { DetectedLanguage } from "@ysa-ai/ysa/runtime";
import { getProvider } from "@ysa-ai/shared";
import { writeStatus, upsertStepPrompt } from "../lib/status";
import { getProjectConfig } from "../lib/project-bootstrap";

async function fetchGitlabProjectId(issueUrlTemplate: string, token: string | null | undefined): Promise<number | null> {
  if (!issueUrlTemplate || !token) return null;
  try {
    const url = new URL(issueUrlTemplate.replace("{id}", "0"));
    const parts = url.pathname.split("/-/");
    if (parts.length < 2) return null;
    const projectPath = parts[0].replace(/^\//, "");
    if (!projectPath) return null;
    const apiUrl = `${url.protocol}//${url.hostname}/api/v4/projects/${encodeURIComponent(projectPath)}`;
    const res = await fetch(apiUrl, { headers: { "PRIVATE-TOKEN": token }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { id?: number };
    return data.id ?? null;
  } catch {
    return null;
  }
}

async function pickViaAgent(userId: number, command: "pickDirectory" | "pickFile" | "pickFileOrFolder", payload: Record<string, unknown> = {}): Promise<string | null> {
  if (!isAgentConnectedForUser(userId)) throw new Error("Agent not connected — cannot open file picker");
  const ack = await sendCommand(command, payload, 300_000);
  return (ack.data as any)?.path ?? null;
}

async function validatePathViaAgent(userId: number, path: string): Promise<void> {
  if (!isAgentConnectedForUser(userId)) return;
  const ack = await sendCommand("validatePath", { path }, 10_000);
  if (!ack.ok) throw new Error(ack.error ?? `Path is not a directory: ${path}`);
}

async function upsertCredentialPreference(
  userId: number,
  projectId: string,
  fields: { default_credential_name?: string | null; issue_source_credential_name?: string | null; ai_configs?: string | null },
): Promise<void> {
  const condition = and(
    eq(userProjectCredentialPreferences.user_id, userId),
    eq(userProjectCredentialPreferences.project_id, projectId),
  );
  const existing = (await db.select({ id: userProjectCredentialPreferences.id }).from(userProjectCredentialPreferences).where(condition))[0];
  if (existing) {
    await db.update(userProjectCredentialPreferences)
      .set({ ...fields, updated_at: new Date().toISOString() })
      .where(condition);
  } else {
    await db.insert(userProjectCredentialPreferences).values({
      user_id: userId,
      project_id: projectId,
      ...fields,
    });
  }
}

const orgProjectInput = z.object({
  name: z.string().min(1),
  branch_prefix: z.string().optional(),
  default_branch: z.string().optional(),
  issue_url_template: z.string().optional(),
  worktree_files: z.string().nullable().optional(),
  languages: z.string().nullable().optional(),
  container_memory: z.string().optional(),
  container_cpus: z.number().int().positive().optional(),
  container_pids_limit: z.number().int().positive().optional(),
  container_timeout: z.number().int().positive().optional(),
  llm_provider: z.string().optional(),
  llm_max_turns: z.number().int().positive().optional(),
  llm_allowed_tools: z.string().nullable().optional(),
  llm_model: z.string().nullable().optional(),
  network_policy: z.enum(["none", "strict", "custom"]).optional(),
  issue_source: z.enum(["gitlab", "github"]).optional(),
  code_repo_url: z.string().nullable().optional(),
  install_cmd: z.string().nullable().optional(),
  build_cmd: z.string().nullable().optional(),
  pre_dev_cmd: z.string().nullable().optional(),
  dev_servers: z.string().nullable().optional(),
  qa_enabled: z.number().int().min(0).max(1).optional(),
  test_cmd: z.string().nullable().optional(),
  deps_cache_files: z.string().nullable().optional(),
});

const userSettingsInput = z.object({
  project_root: z.string().optional(),
  worktree_prefix: z.string().optional(),
  npmrc_path: z.string().nullable().optional(),
  env_vars: z.string().nullable().optional(),
  mcp_config: z.string().nullable().optional(),
  issue_source_token: z.string().nullable().optional(),
  default_credential_name: z.string().nullable().optional(),
  issue_source_credential_name: z.string().nullable().optional(),
  container_memory: z.string().nullable().optional(),
  container_cpus: z.number().int().positive().nullable().optional(),
  container_pids_limit: z.number().int().positive().nullable().optional(),
  container_timeout: z.number().int().positive().nullable().optional(),
});

async function upsertUserSettings(
  userId: number,
  projectId: string,
  input: z.infer<typeof userSettingsInput>,
) {
  const { project_root, worktree_prefix, npmrc_path, env_vars, mcp_config, issue_source_token, default_credential_name, issue_source_credential_name, container_memory, container_cpus, container_pids_limit, container_timeout } = input;
  const finalWorktreePrefix = worktree_prefix !== undefined
    ? worktree_prefix
    : (project_root ? `${project_root}/.ysa/worktrees/` : undefined);

  const condition = and(eq(userProjectSettings.user_id, userId), eq(userProjectSettings.project_id, projectId));
  const existing = (await db.select({ id: userProjectSettings.id }).from(userProjectSettings).where(condition))[0];

  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (project_root !== undefined) values.project_root = project_root;
  if (finalWorktreePrefix !== undefined) values.worktree_prefix = finalWorktreePrefix;
  if (npmrc_path !== undefined) values.npmrc_path = npmrc_path;
  if (env_vars !== undefined) values.env_vars = env_vars;
  if (mcp_config !== undefined) values.mcp_config = mcp_config;
  if (issue_source_token) values.issue_source_token = encrypt(issue_source_token, config.masterKey);
  else if (issue_source_token === null) values.issue_source_token = null;
  if (container_memory !== undefined) values.container_memory = container_memory;
  if (container_cpus !== undefined) values.container_cpus = container_cpus;
  if (container_pids_limit !== undefined) values.container_pids_limit = container_pids_limit;
  if (container_timeout !== undefined) values.container_timeout = container_timeout;

  if (existing) {
    await db.update(userProjectSettings).set(values as any).where(condition);
  } else {
    await db.insert(userProjectSettings).values({
      user_id: userId,
      project_id: projectId,
      project_root: (project_root ?? null) as string | null,
      worktree_prefix: (finalWorktreePrefix ?? null) as string | null,
      npmrc_path: (npmrc_path ?? null) as string | null,
      env_vars: (env_vars ?? null) as string | null,
      mcp_config: (mcp_config ?? null) as string | null,
      issue_source_token: (values.issue_source_token ?? null) as string | null,
      container_memory: (container_memory ?? null) as string | null,
      container_cpus: (container_cpus ?? null) as number | null,
      container_pids_limit: (container_pids_limit ?? null) as number | null,
      container_timeout: (container_timeout ?? null) as number | null,
    });
  }

  const credFields: { default_credential_name?: string | null; issue_source_credential_name?: string | null } = {};
  if (default_credential_name !== undefined) credFields.default_credential_name = default_credential_name ?? null;
  if (issue_source_credential_name !== undefined) credFields.issue_source_credential_name = issue_source_credential_name ?? null;
  if (Object.keys(credFields).length > 0) {
    await upsertCredentialPreference(userId, projectId, credFields);
  }
}

export const projectsRouter = router({
  pickDirectory: publicProcedure.mutation(async ({ ctx }) => {
    const path = await pickViaAgent(ctx.userId, "pickDirectory");
    return { path };
  }),

  validateProjectRoot: publicProcedure
    .input(z.object({ path: z.string() }))
    .mutation(async ({ input }) => {
      try {
        await sendCommand("validateProjectRoot", { path: input.path }, 10000);
        return { ok: true, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("timed out")) return { ok: true, error: null };
        return { ok: false, error: message };
      }
    }),

  pickFile: publicProcedure
    .input(z.object({ prompt: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const path = await pickViaAgent(ctx.userId, "pickFile", { prompt: input.prompt ?? "Select file" });
      return { path };
    }),

  pickFileOrFolder: publicProcedure
    .mutation(async ({ ctx }) => {
      const path = await pickViaAgent(ctx.userId, "pickFileOrFolder");
      return { path };
    }),

  list: publicProcedure.query(async ({ ctx }) => {
    return db.select().from(projects).where(eq(projects.org_id, ctx.orgId)).orderBy(projects.name);
  }),

  get: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      const row = (await db
        .select()
        .from(projects)
        .where(eq(projects.project_id, input.projectId)))[0];
      if (!row) throw new Error(`Project ${input.projectId} not found`);
      return row;
    }),

  getUserSettings: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      const row = (await db.select().from(userProjectSettings)
        .where(and(eq(userProjectSettings.user_id, ctx.userId), eq(userProjectSettings.project_id, input.projectId))))[0];
      const credPref = (await db.select().from(userProjectCredentialPreferences)
        .where(and(eq(userProjectCredentialPreferences.user_id, ctx.userId), eq(userProjectCredentialPreferences.project_id, input.projectId))))[0];
      return {
        project_root: row?.project_root ?? "",
        worktree_prefix: row?.worktree_prefix ?? "",
        npmrc_path: row?.npmrc_path ?? "",
        env_vars: row?.env_vars ?? "",
        mcp_config: row?.mcp_config ?? "",
        issue_source_token: row?.issue_source_token ? "" : null,
        default_credential_name: credPref?.default_credential_name ?? null,
        issue_source_credential_name: credPref?.issue_source_credential_name ?? null,
        ai_configs: credPref?.ai_configs ?? null,
        container_memory: row?.container_memory ?? null,
        container_cpus: row?.container_cpus ?? null,
        container_pids_limit: row?.container_pids_limit ?? null,
        container_timeout: row?.container_timeout ?? null,
      };
    }),

  updateUserSettings: publicProcedure
    .input(z.object({ projectId: z.string() }).merge(userSettingsInput))
    .mutation(async ({ input, ctx }) => {
      const { projectId, ...userFields } = input;
      await requireProjectAccess(ctx.orgId, projectId);
      if (userFields.project_root) await validatePathViaAgent(ctx.userId, userFields.project_root);
      await upsertUserSettings(ctx.userId, projectId, userFields);
      pushSyncConfig([projectId]).catch(() => {});

      return { ok: true };
    }),

  create: publicProcedure
    .input(orgProjectInput.merge(userSettingsInput))
    .mutation(async ({ input, ctx }) => {
      const { project_root, worktree_prefix, npmrc_path, env_vars, mcp_config, issue_source_token, ...orgFields } = input;

      if (project_root) await validatePathViaAgent(ctx.userId, project_root);

      const projectId = orgFields.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

      const existing = (await db
        .select()
        .from(projects)
        .where(eq(projects.project_id, projectId)))[0];
      if (existing) throw new Error(`Project "${orgFields.name}" already exists`);

      const [builtinWf] = await db.select({ id: workflows.id }).from(workflows)
        .where(eq(workflows.is_builtin, true)).limit(1);
      const workflowId: number | null = builtinWf?.id ?? null;

      await db.insert(projects).values({
        project_id: projectId,
        name: orgFields.name,
        branch_prefix: orgFields.branch_prefix ?? "fix/",
        default_branch: orgFields.default_branch ?? "main",
        workflow_id: workflowId,
        issue_url_template: orgFields.issue_url_template ?? "",
        worktree_files: orgFields.worktree_files ?? null,
        languages: orgFields.languages ?? null,
        container_memory: orgFields.container_memory ?? "4g",
        container_cpus: orgFields.container_cpus ?? 2,
        container_pids_limit: orgFields.container_pids_limit ?? 512,
        container_timeout: orgFields.container_timeout ?? 3600,
        llm_provider: orgFields.llm_provider ?? "claude",
        llm_max_turns: orgFields.llm_max_turns ?? 60,
        llm_allowed_tools: orgFields.llm_allowed_tools ?? null,
        llm_model: orgFields.llm_model ?? null,
        network_policy: orgFields.network_policy ?? "none",
        install_cmd: orgFields.install_cmd ?? null,
        build_cmd: orgFields.build_cmd ?? null,
        pre_dev_cmd: orgFields.pre_dev_cmd ?? null,
        dev_servers: orgFields.dev_servers ?? null,
        qa_enabled: (orgFields.qa_enabled ?? 0) === 1,
        test_cmd: orgFields.test_cmd ?? null,
        deps_cache_files: orgFields.deps_cache_files ?? null,
        issue_source: orgFields.issue_source ?? "gitlab",
        code_repo_url: orgFields.code_repo_url ?? null,
        gitlab_project_id: await fetchGitlabProjectId(orgFields.issue_url_template ?? "", issue_source_token),
        org_id: ctx.orgId,
      });

      if (project_root || worktree_prefix || npmrc_path || env_vars || mcp_config || issue_source_token) {
        await upsertUserSettings(ctx.userId, projectId, { project_root, worktree_prefix, npmrc_path, env_vars, mcp_config, issue_source_token });
      }

      pushSyncConfig([projectId]).catch(() => {});
      return (await db.select().from(projects).where(eq(projects.project_id, projectId)))[0]!;
    }),

  update: publicProcedure
    .input(z.object({ projectId: z.string() }).merge(orgProjectInput.partial()))
    .mutation(async ({ input, ctx }) => {
      const { projectId, ...fields } = input;

      await requireProjectAccess(ctx.orgId, projectId);
      const existing = (await db
        .select()
        .from(projects)
        .where(eq(projects.project_id, projectId)))[0];
      if (!existing) throw new Error(`Project ${projectId} not found`);

      const { ...rest } = fields;

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [key, val] of Object.entries(rest)) {
        if (val !== undefined) updates[key] = val;
      }

      if (fields.issue_url_template !== undefined) {
        const template = fields.issue_url_template ?? existing.issue_url_template;
        const userSettings = (await db.select().from(userProjectSettings)
          .where(and(eq(userProjectSettings.project_id, projectId), eq(userProjectSettings.user_id, ctx.userId)))
          .limit(1))[0];
        const encToken = userSettings?.issue_source_token;
        const token = encToken ? decrypt(encToken, config.masterKey) : null;
        const gitlabProjectId = await fetchGitlabProjectId(template, token);
        if (gitlabProjectId !== null) updates.gitlab_project_id = gitlabProjectId;
      }

      await db.update(projects)
        .set(updates as any)
        .where(eq(projects.project_id, projectId));

      let buildTriggered = false;

      // Trigger background image build when languages change
      const newLangs = fields.languages ?? null;
      if (newLangs !== undefined && newLangs !== (existing.languages ?? null)) {
        const langs: DetectedLanguage[] = (() => { try { return JSON.parse(newLangs ?? "[]"); } catch { return []; } })();
        const adapter = getProvider(existing.llm_provider ?? "claude");
        const { tools, env, runtimeEnv, apkPackages, copyDirs } = getMiseToolsForLanguages(langs);
        const oldLangs: DetectedLanguage[] = (() => { try { return JSON.parse(existing.languages ?? "[]"); } catch { return []; } })();
        const { apkPackages: oldApkPackages } = oldLangs.length ? getMiseToolsForLanguages(oldLangs) : { apkPackages: [] as string[] };
        const hadApkImage = oldApkPackages.length > 0;

        const userSettings = (await db.select().from(userProjectSettings)
          .where(and(eq(userProjectSettings.project_id, projectId), eq(userProjectSettings.user_id, ctx.userId))).limit(1))[0];
        const projectRoot = userSettings?.project_root;
        const projectImage = projectRoot && apkPackages.length > 0 ? projectImageName(projectRoot, adapter.id) : adapter.containerImage;
        const miseVolume = `mise-installs-${projectId}`;

        const ysaToml = apkPackages.length > 0
          ? `[sandbox]\npackages = [${apkPackages.map((p) => `"${p}"`).join(", ")}]\n`
          : "";
        const buildPayload = {
          projectId,
          projectRoot: projectRoot ?? null,
          ysaToml,
          apkPackages,
          projectImage,
          containerImage: adapter.containerImage,
          packageManager: adapter.packageManager,
          tools,
          miseVolume,
          env,
          runtimeEnv,
          copyDirs,
          hadApkImage,
          oldImage: hadApkImage && projectRoot ? projectImageName(projectRoot, adapter.id) : null,
        };

        if (apkPackages.length > 0 || tools.length > 0) {
          buildTriggered = true;
          startBuild(projectId, async () => {
            try {
              const ack = await sendCommand("buildProject", buildPayload, 600_000);
              return ack.ok ? { ok: true } : { ok: false, error: ack.error ?? "Build failed" };
            } catch (err: any) {
              return { ok: false, error: err.message };
            }
          });
        } else if (hadApkImage) {
          sendCommand("buildProject", buildPayload, 30_000).catch(() => {});
        }
      }

      const project = (await db.select().from(projects).where(eq(projects.project_id, projectId)))[0]!;
      return { project, buildTriggered };
    }),

  delete: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      await requireAdminRole(ctx.orgId, ctx.userId);
      const row = (await db
        .select()
        .from(projects)
        .where(eq(projects.project_id, input.projectId)))[0];
      if (!row) throw new Error(`Project ${input.projectId} not found`);
      if (row.is_default) throw new Error("Cannot delete the default project");

      const activeIssues = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.project_id, input.projectId),
            inArray(tasks.status, ["running", "starting"]),
          ),
        );
      if (activeIssues.length > 0) {
        throw new Error(
          `Cannot delete: ${activeIssues.length} active task(s) in this project`,
        );
      }

      await db.delete(projects).where(eq(projects.project_id, input.projectId));
      return { ok: true };
    }),

  setWorkflow: publicProcedure
    .input(z.object({ projectId: z.string(), workflowId: z.number().nullable() }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      const existing = (await db
        .select()
        .from(projects)
        .where(eq(projects.project_id, input.projectId)))[0];
      if (!existing) throw new Error(`Project ${input.projectId} not found`);

      await db.update(projects)
        .set({ workflow_id: input.workflowId, updated_at: new Date().toISOString() } as any)
        .where(eq(projects.project_id, input.projectId));

      return { ok: true };
    }),

  setDefault: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      const row = (await db
        .select()
        .from(projects)
        .where(eq(projects.project_id, input.projectId)))[0];
      if (!row) throw new Error(`Project ${input.projectId} not found`);

      await db.update(projects)
        .set({ is_default: false, updated_at: new Date().toISOString() } as any)
        .where(and(eq(projects.org_id, ctx.orgId), ne(projects.project_id, input.projectId)));

      await db.update(projects)
        .set({ is_default: true, updated_at: new Date().toISOString() } as any)
        .where(eq(projects.project_id, input.projectId));

      return { ok: true };
    }),

  listCredentials: publicProcedure.query(async ({ ctx }) => {
    const { sendCommand, isAgentConnectedForUser } = await import("../ws/dispatch");
    if (!isAgentConnectedForUser(ctx.userId)) return { credentials: [] };
    try {
      const ack = await sendCommand("listCredentials", {}, 10_000);
      return { credentials: (ack.data as any)?.credentials ?? [] };
    } catch {
      return { credentials: [] };
    }
  }),

  upsertCredentialPreference: publicProcedure
    .input(z.object({
      projectId: z.string(),
      defaultCredentialName: z.string().nullable().optional(),
      issueSourceCredentialName: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      const fields: { default_credential_name?: string | null; issue_source_credential_name?: string | null } = {};
      if (input.defaultCredentialName !== undefined) fields.default_credential_name = input.defaultCredentialName;
      if (input.issueSourceCredentialName !== undefined) fields.issue_source_credential_name = input.issueSourceCredentialName;
      await upsertCredentialPreference(ctx.userId, input.projectId, fields);
      return { ok: true };
    }),

  listServerCredentials: publicProcedure.query(async ({ ctx }) => {
    const rows = await db.select({
      name: userCredentials.name,
      provider: userCredentials.provider,
      type: userCredentials.type,
      created_at: userCredentials.created_at,
    }).from(userCredentials).where(eq(userCredentials.user_id, ctx.userId));
    return { credentials: rows };
  }),

  addServerCredential: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      provider: z.string().min(1),
      type: z.enum(["access_token"]),
      value: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = (await db.select({ id: userCredentials.id })
        .from(userCredentials)
        .where(and(eq(userCredentials.user_id, ctx.userId), eq(userCredentials.name, input.name))))[0];
      if (existing) throw new Error(`Credential "${input.name}" already exists. Remove it first to replace.`);
      await db.insert(userCredentials).values({
        user_id: ctx.userId,
        name: input.name,
        provider: input.provider,
        type: input.type,
        encrypted_value: encrypt(input.value, config.masterKey),
      });
      return { ok: true };
    }),

  removeServerCredential: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.delete(userCredentials)
        .where(and(eq(userCredentials.user_id, ctx.userId), eq(userCredentials.name, input.name)));
      return { ok: true };
    }),

  updateAiConfigs: publicProcedure
    .input(z.object({ projectId: z.string(), aiConfigs: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      await upsertCredentialPreference(ctx.userId, input.projectId, { ai_configs: input.aiConfigs });
      return { ok: true };
    }),
});
