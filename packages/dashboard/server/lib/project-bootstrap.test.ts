import { mock, describe, test, expect, spyOn } from "bun:test";
import { applyUserSettings } from "./project-bootstrap";
import { encrypt, decrypt } from "./crypto";

// 32-byte (64 hex char) key for testing
const masterKey = "0".repeat(64);

const orgBase = {
  projectId: "my-project",
  branchPrefix: "fix/",
  issueUrlTemplate: "https://gitlab.com/org/repo/-/issues/{id}",
  issuesDir: "/tmp/issues",
  port: 3333,
  worktreeFiles: [],
  languages: [],
  networkPolicy: "none",
  installCmd: "",
  buildCmd: "",
  preDevCmd: undefined as string | undefined,
  devServers: [],
  qaEnabled: false,
  testCmd: "",
  llmProvider: "claude",
  llmModel: undefined as string | undefined,
  llmMaxTurns: 60,
  llmAllowedTools: undefined as string | undefined,
  defaultCredentialName: null as string | null,
  issueSource: "gitlab" as const,
  containerMemory: "4g",
  containerCpus: 2,
  containerPidsLimit: 512,
  containerTimeout: 3600,
};

describe("applyUserSettings", () => {
  test("returns empty paths when user settings is null and no org token", () => {
    const result = applyUserSettings(orgBase, null, null, masterKey);
    expect(result.projectRoot).toBe("");
    expect(result.worktreePrefix).toBe("");
    expect(result.npmrcPath).toBeUndefined();
    expect(result.envFiles).toEqual([]);
    expect(result.mcpConfig).toBeNull();
    expect(result.issueSourceToken).toBeNull();
  });

  test("applies user project_root and worktree_prefix", () => {
    const result = applyUserSettings(orgBase, {
      project_root: "/home/alice/repo",
      worktree_prefix: "/home/alice/worktrees/",
      npmrc_path: null,
      env_vars: null,
      mcp_config: null,
      issue_source_token: null,
    }, null, masterKey);
    expect(result.projectRoot).toBe("/home/alice/repo");
    expect(result.worktreePrefix).toBe("/home/alice/worktrees/");
  });

  test("applies npmrc_path and mcp_config", () => {
    const result = applyUserSettings(orgBase, {
      project_root: null,
      worktree_prefix: null,
      npmrc_path: "~/.npmrc",
      env_vars: null,
      mcp_config: "/path/.mcp.json",
      issue_source_token: null,
    }, null, masterKey);
    expect(result.npmrcPath).toBe("~/.npmrc");
    expect(result.mcpConfig).toBe("/path/.mcp.json");
  });

  test("parses env_vars as comma-separated list", () => {
    const result = applyUserSettings(orgBase, {
      project_root: null,
      worktree_prefix: null,
      npmrc_path: null,
      env_vars: "/path/a.env, /path/b.env",
      mcp_config: null,
      issue_source_token: null,
    }, null, masterKey);
    expect(result.envFiles).toEqual(["/path/a.env", "/path/b.env"]);
  });

  test("user issue_source_token wins over org token", () => {
    const orgToken = encrypt("org-token", masterKey);
    const userToken = encrypt("user-token", masterKey);
    const result = applyUserSettings(orgBase, {
      project_root: null,
      worktree_prefix: null,
      npmrc_path: null,
      env_vars: null,
      mcp_config: null,
      issue_source_token: userToken,
    }, orgToken, masterKey);
    expect(result.issueSourceToken).toBe("user-token");
  });

  test("falls back to org token when user has no token", () => {
    const orgToken = encrypt("org-token", masterKey);
    const result = applyUserSettings(orgBase, {
      project_root: null,
      worktree_prefix: null,
      npmrc_path: null,
      env_vars: null,
      mcp_config: null,
      issue_source_token: null,
    }, orgToken, masterKey);
    expect(result.issueSourceToken).toBe("org-token");
  });

  test("preserves org-level fields from base unchanged", () => {
    const result = applyUserSettings(orgBase, null, null, masterKey);
    expect(result.projectId).toBe("my-project");
    expect(result.branchPrefix).toBe("fix/");
    expect(result.llmProvider).toBe("claude");
    expect(result.issueSource).toBe("gitlab");
  });

  test("handles undefined user settings same as null", () => {
    const result = applyUserSettings(orgBase, undefined, undefined, masterKey);
    expect(result.projectRoot).toBe("");
    expect(result.issueSourceToken).toBeNull();
  });
});

describe("credential preferences", () => {
  test("defaultCredentialName from base flows through unchanged", () => {
    const base = { ...orgBase, defaultCredentialName: "my-claude-key" };
    const result = applyUserSettings(base, null, null, masterKey);
    expect(result.defaultCredentialName).toBe("my-claude-key");
  });

  test("returns null credential name when base has null", () => {
    const result = applyUserSettings(orgBase, null, null, masterKey);
    expect(result.defaultCredentialName).toBeNull();
  });

  test("does not call decrypt for credential name (it is never encrypted)", () => {
    const decryptSpy = spyOn({ decrypt }, "decrypt");
    const base = { ...orgBase, defaultCredentialName: "some-cred" };
    const result = applyUserSettings(base, null, null, masterKey);
    expect(result.defaultCredentialName).toBe("some-cred");
    // decrypt is only called for tokens, never for credential name
    expect(decryptSpy).not.toHaveBeenCalledWith("some-cred", masterKey);
  });
});

describe("container settings in applyUserSettings", () => {
  test("uses base container defaults when user has none", () => {
    const result = applyUserSettings(orgBase, null, null, masterKey);
    expect(result.containerMemory).toBe("4g");
    expect(result.containerCpus).toBe(2);
    expect(result.containerPidsLimit).toBe(512);
    expect(result.containerTimeout).toBe(3600);
  });

  test("user container fields override base defaults", () => {
    const result = applyUserSettings(orgBase, {
      container_memory: "8g",
      container_cpus: 4,
      container_pids_limit: 1024,
      container_timeout: 7200,
    }, null, masterKey);
    expect(result.containerMemory).toBe("8g");
    expect(result.containerCpus).toBe(4);
    expect(result.containerPidsLimit).toBe(1024);
    expect(result.containerTimeout).toBe(7200);
  });

  test("null user container fields fall back to base", () => {
    const result = applyUserSettings(orgBase, {
      container_memory: null,
      container_cpus: null,
      container_pids_limit: null,
      container_timeout: null,
    }, null, masterKey);
    expect(result.containerMemory).toBe("4g");
    expect(result.containerCpus).toBe(2);
    expect(result.containerPidsLimit).toBe(512);
    expect(result.containerTimeout).toBe(3600);
  });

  test("partial user container fields: only overrides provided values", () => {
    const result = applyUserSettings(orgBase, { container_memory: "16g" }, null, masterKey);
    expect(result.containerMemory).toBe("16g");
    expect(result.containerCpus).toBe(2);
  });
});
