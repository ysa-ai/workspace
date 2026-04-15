import { db } from "../db";
import { projects, userProjectSettings, userProjectCredentialPreferences } from "../db/schema";
import { config } from "../config";
import { decrypt } from "./crypto";
import { eq, and } from "drizzle-orm";
import { sendCommand, isAgentConnected } from "../ws/dispatch";

type UserSettingsLike = {
  project_root?: string | null;
  worktree_prefix?: string | null;
  npmrc_path?: string | null;
  env_vars?: string | null;
  mcp_config?: string | null;
  issue_source_token?: string | null;
  container_memory?: string | null;
  container_cpus?: number | null;
  container_pids_limit?: number | null;
  container_timeout?: number | null;
};

export interface AiConfigEntry {
  provider: string;
  model: string;
  max_turns: number;
  allowed_tools: string;
  credential_name: string | null;
  is_default: boolean;
}

export type ProjectConfig = {
  projectId?: string;
  orgId?: string;
  projectRoot: string;
  worktreePrefix: string;
  branchPrefix: string;
  issueUrlTemplate: string;
  port: number;
  mcpConfig: string | null;
  envFiles: string[];
  npmrcPath: string | undefined;
  worktreeFiles: any[];
  languages: string[];
  networkPolicy: string;
  installCmd: string;
  buildCmd: string;
  preDevCmd: string | undefined;
  devServers: any[];
  qaEnabled: boolean;
  testCmd: string;
  llmProvider: string;
  llmModel: string | undefined;
  llmMaxTurns: number;
  llmAllowedTools: string | undefined;
  defaultCredentialName: string | null;
  issueSource: "gitlab" | "github";
  issueSourceToken: string | null;
  defaultBranch?: string;
  codeRepoUrl?: string;
  gitlabProjectId?: number;
  depsCacheFiles?: string[];
  containerMemory: string;
  containerCpus: number;
  containerPidsLimit: number;
  containerTimeout: number;
};

export function applyUserSettings(
  base: Omit<ProjectConfig, "projectRoot" | "worktreePrefix" | "npmrcPath" | "envFiles" | "mcpConfig" | "issueSourceToken">,
  userSettings: UserSettingsLike | null | undefined,
  orgToken: string | null | undefined,
  masterKey: string,
): ProjectConfig {
  let issueSourceToken: string | null = null;
  if (orgToken) issueSourceToken = decrypt(orgToken, masterKey);
  if (userSettings?.issue_source_token) issueSourceToken = decrypt(userSettings.issue_source_token, masterKey);

  return {
    ...base,
    projectRoot: userSettings?.project_root ?? "",
    worktreePrefix: userSettings?.worktree_prefix ?? "",
    npmrcPath: userSettings?.npmrc_path ?? undefined,
    envFiles: userSettings?.env_vars ? userSettings.env_vars.split(",").map((s: string) => s.trim()) : [],
    mcpConfig: userSettings?.mcp_config ?? null,
    issueSourceToken,
    containerMemory: userSettings?.container_memory ?? base.containerMemory,
    containerCpus: userSettings?.container_cpus ?? base.containerCpus,
    containerPidsLimit: userSettings?.container_pids_limit ?? base.containerPidsLimit,
    containerTimeout: userSettings?.container_timeout ?? base.containerTimeout,
  };
}

export async function getProjectConfig(projectId: string | null, userId?: number): Promise<ProjectConfig> {
  const base: Omit<ProjectConfig, "projectRoot" | "worktreePrefix" | "npmrcPath" | "envFiles" | "mcpConfig" | "issueSourceToken"> = {
    branchPrefix: "fix/",
    issueUrlTemplate: "",
    port: config.port,
    worktreeFiles: [],
    languages: [],
    networkPolicy: "none",
    installCmd: "",
    buildCmd: "",
    preDevCmd: undefined,
    devServers: [],
    qaEnabled: false,
    testCmd: "",
    llmProvider: "claude",
    llmModel: undefined,
    llmMaxTurns: 60,
    llmAllowedTools: undefined,
    defaultCredentialName: null,
    issueSource: "gitlab",
    containerMemory: "4g",
    containerCpus: 2,
    containerPidsLimit: 512,
    containerTimeout: 3600,
  };

  if (!projectId) {
    return applyUserSettings(base, null, null, config.masterKey);
  }

  const row = (await db.select().from(projects).where(eq(projects.project_id, projectId)))[0];
  if (!row) return applyUserSettings(base, null, null, config.masterKey);

  let userSettings: UserSettingsLike | null = null;
  let defaultCredentialName: string | null = null;
  let issueSourceCredentialName: string | null = null;
  let llmProvider = "claude";
  let llmModel: string | undefined;
  let llmMaxTurns = 60;
  let llmAllowedTools: string | undefined;

  if (userId) {
    userSettings = (await db.select().from(userProjectSettings)
      .where(and(eq(userProjectSettings.user_id, userId), eq(userProjectSettings.project_id, projectId))))[0] ?? null;

    const credPref = (await db.select().from(userProjectCredentialPreferences)
      .where(and(eq(userProjectCredentialPreferences.user_id, userId), eq(userProjectCredentialPreferences.project_id, projectId))))[0];
    issueSourceCredentialName = credPref?.issue_source_credential_name ?? null;

    if (credPref?.ai_configs) {
      try {
        const aiConfigs: AiConfigEntry[] = JSON.parse(credPref.ai_configs);
        const defaultEntry = aiConfigs.find((c) => c.is_default) ?? aiConfigs[0];
        if (defaultEntry) {
          llmProvider = defaultEntry.provider;
          llmModel = defaultEntry.model || undefined;
          llmMaxTurns = defaultEntry.max_turns || 60;
          llmAllowedTools = defaultEntry.allowed_tools || undefined;
          defaultCredentialName = defaultEntry.credential_name;
        }
      } catch {}
    }
  }

  // Resolve issue source token: prefer locally stored credential, fall back to server-stored token
  let resolvedIssueSourceToken: string | null = null;
  if (issueSourceCredentialName && isAgentConnected()) {
    try {
      const ack = await sendCommand("getCredential", { name: issueSourceCredentialName }, 5_000);
      resolvedIssueSourceToken = (ack.data as any)?.key ?? null;
    } catch {}
  }

  const orgBase: Omit<ProjectConfig, "projectRoot" | "worktreePrefix" | "npmrcPath" | "envFiles" | "mcpConfig" | "issueSourceToken"> = {
    projectId: row.project_id,
    orgId: row.org_id ? String(row.org_id) : undefined,
    branchPrefix: row.branch_prefix,
    issueUrlTemplate: row.issue_url_template,
    worktreeFiles: (() => { try { return JSON.parse(row.worktree_files ?? "[]"); } catch { return []; } })(),
    languages: (() => { try { return JSON.parse(row.languages ?? "[]"); } catch { return []; } })(),
    networkPolicy: row.network_policy,
    installCmd: row.install_cmd || "",
    buildCmd: row.build_cmd || "",
    preDevCmd: row.pre_dev_cmd || undefined,
    devServers: row.dev_servers ? JSON.parse(row.dev_servers) : [],
    qaEnabled: row.qa_enabled === true,
    testCmd: row.test_cmd || "",
    llmProvider,
    llmModel,
    llmMaxTurns,
    llmAllowedTools,
    defaultCredentialName,
    issueSource: (row.issue_source as "gitlab" | "github") || "gitlab",
    defaultBranch: row.default_branch || undefined,
    codeRepoUrl: row.code_repo_url || undefined,
    gitlabProjectId: row.gitlab_project_id || undefined,
    depsCacheFiles: (() => { try { return JSON.parse(row.deps_cache_files ?? "[]"); } catch { return []; } })(),
    port: config.port,
    containerMemory: "4g",
    containerCpus: 2,
    containerPidsLimit: 512,
    containerTimeout: 3600,
  };

  const result = applyUserSettings(orgBase, userSettings, row.issue_source_token, config.masterKey);
  // If credential-based token resolved, it takes precedence
  if (resolvedIssueSourceToken) result.issueSourceToken = resolvedIssueSourceToken;
  return result;
}
