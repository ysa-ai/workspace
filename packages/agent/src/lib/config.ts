export interface DevServer {
  name: string;
  cmd: string;
  port: number;
  host?: string;
  env?: Record<string, string>;
}

// Metadata only — secret values (passwords) are never persisted to the agent config cache.
export interface AppCredentialMeta {
  name: string;
  loginUrl?: string;
  username?: string;
}

export interface AgentConfig {
  projectRoot: string;
  worktreePrefix: string;
  branchPrefix: string;
  installCmd: string;
  buildCmd: string;
  preDevCmd?: string;
  envFiles: string[];
  npmrcPath?: string;
  worktreeFiles: string[];
  devServers: DevServer[];
  startServers: DevServer[];
  appCredentials?: AppCredentialMeta[];
  mcpConfig: string | null;
  dashboardPort: number;
  issuesDir: string;
  issueUrlTemplate: string;
  qaEnabled: boolean;
  testCmd: string;
  networkPolicy: "none" | "strict" | "custom";
  llmProvider?: string;
  llmModel?: string;
  llmMaxTurns?: number;
  llmAllowedTools?: string;
  defaultCredentialName?: string;
  containerMemory?: string;
  containerCpus?: number;
  containerPidsLimit?: number;
  containerStackSize?: number;
  containerTimeout?: number;
  bypassHosts?: string[];
  containerInitCommands?: string[];
  packages?: string[];
  issueSource?: "gitlab" | "github";
  sourceType?: "provider" | "prompt" | "detect";
  codeRepoUrl?: string;
  gitlabProjectId?: number;
  projectId?: string;
  orgId?: string;
  languages?: string[];
  depsCacheFiles?: string[];
  branchOverrides?: Record<string, string>;
  defaultBranch?: string;
}
