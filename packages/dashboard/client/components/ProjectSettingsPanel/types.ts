export interface DevServerEntry {
  name: string;
  cmd: string;
  port: string;
  env: string;
}

export interface SharedFormValues {
  name: string;
  branch_prefix: string;
  default_branch: string;
  issue_source: string;
  issue_url_template: string;
  code_repo_url: string;
  worktree_files: { value: string }[];
  languages: string[];
  network_policy: string;
  install_cmd: string;
  build_cmd: string;
  pre_dev_cmd: string;
  dev_servers: DevServerEntry[];
  test_cmd: string;
  deps_cache_files: string;
}

export interface UserFormValues {
  project_root: string;
  worktree_prefix: string;
  npmrc_path: string;
  env_vars: string;
  mcp_config: string;
  issue_source_credential_name: string | null;
  container_memory: string;
  container_cpus: number;
  container_pids_limit: number;
  container_timeout: number;
}

export interface Project {
  project_id: string;
  name: string;
  branch_prefix: string;
  default_branch: string;
  issue_url_template: string;
  worktree_files: string | null;
  languages: string | null;
  container_memory: string;
  container_cpus: number;
  container_pids_limit: number;
  container_timeout: number;
  network_policy: string;
  issue_source: string;
  code_repo_url: string | null;
  gitlab_project_id: number | null;
  install_cmd: string | null;
  build_cmd: string | null;
  pre_dev_cmd: string | null;
  dev_servers: string | null;
  test_cmd: string | null;
  deps_cache_files: string | null;
  is_default: boolean;
  workflow_id: number | null;
}

export interface ProjectSettingsPanelProps {
  onClose: () => void;
  onSwitchProject?: (projectId: string) => void;
  initialSection?: string;
  initialWorkflowBuilderTarget?: number | null;
  startInCreateMode?: boolean;
  onNavigateWorkflow?: (id: number | null) => void;
  onCloseWorkflow?: () => void;
}

export const PERSONAL_SECTION_IDS = new Set(["paths", "access_token", "ai_settings", "container"]);

export const SECTION_FIELDS: Record<string, string[]> = {
  general: ["name", "branch_prefix", "default_branch"],
  integration: ["issue_source", "issue_url_template", "code_repo_url"],
  build: ["install_cmd", "build_cmd", "pre_dev_cmd", "test_cmd", "languages", "dev_servers", "deps_cache_files"],
  security: ["network_policy"],
  advanced: ["worktree_files"],
  paths: ["project_root", "worktree_prefix", "npmrc_path", "env_vars", "mcp_config"],
  access_token: ["issue_source_credential_name"],
  ai_settings: [],
  container: ["container_memory", "container_cpus", "container_pids_limit", "container_timeout"],
};

export function isSectionDirty(sectionId: string, dirtyFields: object): boolean {
  return SECTION_FIELDS[sectionId]?.some((f) => f in dirtyFields) ?? false;
}

export const SHARED_SECTIONS = [
  { id: "general", label: "General" },
  { id: "integration", label: "Integration" },
  { id: "build", label: "Build" },
  { id: "security", label: "Security" },
  { id: "advanced", label: "Advanced" },
];

export const PERSONAL_SECTIONS = [
  { id: "paths", label: "Paths" },
  { id: "access_token", label: "Access Token" },
  { id: "ai_settings", label: "AI Settings" },
  { id: "container", label: "Container" },
];

export const MODELS_BY_PROVIDER: Record<string, { id: string; name: string }[]> = {
  claude: [
    { id: "claude-sonnet-4-6", name: "Sonnet 4.6" },
    { id: "claude-sonnet-4-5", name: "Sonnet 4.5" },
    { id: "claude-opus-4-6", name: "Opus 4.6" },
  ],
  mistral: [
    { id: "devstral-2", name: "Devstral 2" },
    { id: "mistral-large-latest", name: "Mistral Large 3" },
    { id: "mistral-medium-latest", name: "Mistral Medium 3.1" },
    { id: "devstral-small-latest", name: "Devstral Small" },
    { id: "codestral-latest", name: "Codestral" },
  ],
};

export const INPUT_BASE =
  "bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all";
export const INPUT_CLS = `w-full ${INPUT_BASE}`;
export const INPUT_MONO_CLS = `${INPUT_CLS} font-mono`;

export function envToText(env?: Record<string, string>): string {
  if (!env) return "";
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function textToEnv(text: string): Record<string, string> | undefined {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return undefined;
  const obj: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx > 0) obj[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
}

export function parseDevServers(raw: string | null): DevServerEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s: any) => ({
      name: s.name ?? "",
      cmd: s.cmd ?? "",
      port: String(s.port ?? ""),
      env: envToText(s.env),
    }));
  } catch {
    return [];
  }
}

export function parseWorktreeFiles(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function serializeWorktreeFiles(files: string[]): string | null {
  const valid = files.map((f) => f.trim()).filter(Boolean);
  return valid.length ? JSON.stringify(valid) : null;
}

export function serializeDevServers(entries: DevServerEntry[]): string | null {
  const valid = entries.filter((e) => e.name.trim() || e.cmd.trim());
  if (!valid.length) return null;
  return JSON.stringify(
    valid.map((e) => {
      const s: Record<string, unknown> = {
        name: e.name.trim(),
        cmd: e.cmd.trim(),
        port: parseInt(e.port) || 3000,
      };
      const env = textToEnv(e.env);
      if (env) s.env = env;
      return s;
    }),
  );
}

export const defaultSharedValues: SharedFormValues = {
  name: "",
  branch_prefix: "fix/",
  default_branch: "main",
  issue_source: "gitlab",
  issue_url_template: "",
  code_repo_url: "",
  worktree_files: [],
  languages: [],
  network_policy: "none",
  install_cmd: "",
  build_cmd: "",
  pre_dev_cmd: "",
  dev_servers: [],
  test_cmd: "",
  deps_cache_files: "",
};

export const defaultUserValues: UserFormValues = {
  project_root: "",
  worktree_prefix: "",
  npmrc_path: "",
  env_vars: "",
  mcp_config: "",
  issue_source_credential_name: null,
  container_memory: "4g",
  container_cpus: 2,
  container_pids_limit: 512,
  container_timeout: 3600,
};
