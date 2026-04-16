import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test";

// ── Mocks must come before any import of tested modules ───────────────────────

mock.module("../db", () => ({ db: (globalThis as any).__testDb }));

const mockSendCommand = mock((_cmd: string, _payload?: any, _timeoutMs?: number) =>
  Promise.resolve({ ok: true, data: {} } as any)
);
const mockIsAgentConnected = mock(() => true);
const mockIsAgentConnectedForUser = mock(() => true);

mock.module("../ws/dispatch", () => ({
  sendCommand: mockSendCommand,
  isAgentConnected: mockIsAgentConnected,
  isAgentConnectedForUser: mockIsAgentConnectedForUser,
}));

mock.module("../lib/project-bootstrap", () => ({
  getProjectConfig: mock(() => Promise.resolve({})),
}));


mock.module("fs/promises", () => ({
  mkdir: mock(() => Promise.resolve()),
  writeFile: mock(() => Promise.resolve()),
}));


// ── Now safe to import ────────────────────────────────────────────────────────

import { appRouter } from "./router";
import { db } from "../db";
import { projects, userProjectSettings, userProjectCredentialPreferences } from "../db/schema";
import { eq, and } from "drizzle-orm";
import {
  seedBaseFixtures,
  truncateTaskTables,
  TEST_USER_ID,
  TEST_ORG_ID,
  TEST_PROJECT_ID,
} from "../lib/test-helpers";

function caller(userId = TEST_USER_ID, orgId = TEST_ORG_ID) {
  return appRouter.createCaller({ userId, orgId });
}

async function cleanupProject(projectId: string) {
  await db.delete(userProjectCredentialPreferences).where(eq(userProjectCredentialPreferences.project_id, projectId));
  await db.delete(userProjectSettings).where(eq(userProjectSettings.project_id, projectId));
  await db.delete(projects).where(eq(projects.project_id, projectId));
}

beforeAll(async () => { await seedBaseFixtures(); });

beforeEach(async () => {
  await truncateTaskTables();
  mockSendCommand.mockClear();
  mockSendCommand.mockImplementation(() => Promise.resolve({ ok: true, data: {} }));
  mockIsAgentConnected.mockClear();
  mockIsAgentConnected.mockReturnValue(true);
  mockIsAgentConnectedForUser.mockClear();
  mockIsAgentConnectedForUser.mockReturnValue(true);
  // Clean up wizard-created projects and any user settings written to TEST_PROJECT_ID
  await cleanupProject("wizard-project");
  await cleanupProject("my-new-project");
  await cleanupProject("flow-project");
  await db.delete(userProjectSettings).where(eq(userProjectSettings.project_id, TEST_PROJECT_ID));
  await db.delete(userProjectCredentialPreferences).where(
    and(eq(userProjectCredentialPreferences.project_id, TEST_PROJECT_ID), eq(userProjectCredentialPreferences.user_id, TEST_USER_ID))
  );
});

// ─── projects.create (step 1) ─────────────────────────────────────────────────

describe("projects.create", () => {
  test("generates project_id slug from name", async () => {
    const result = await caller().projects.create({ name: "My New Project" });
    expect(result.project_id).toBe("my-new-project");
    expect(result.name).toBe("My New Project");
  });

  test("throws if project with same slug already exists", async () => {
    await caller().projects.create({ name: "Wizard Project" });
    await expect(caller().projects.create({ name: "Wizard Project" })).rejects.toThrow("already exists");
  });

  test("sets default container limits", async () => {
    const result = await caller().projects.create({ name: "Wizard Project" });
    expect(result.container_memory).toBe("4g");
    expect(result.container_cpus).toBe(2);
    expect(result.container_pids_limit).toBe(512);
    expect(result.container_timeout).toBe(3600);
  });

  test("clones the builtin workflow", async () => {
    const result = await caller().projects.create({ name: "Wizard Project" });
    expect(result.workflow_id).not.toBeNull();
  });

  test("stores user settings and auto-derives worktree_prefix from project_root", async () => {
    const result = await caller().projects.create({ name: "Wizard Project", project_root: "/home/user/myrepo" });
    const rows = await db.select().from(userProjectSettings).where(
      and(eq(userProjectSettings.user_id, TEST_USER_ID), eq(userProjectSettings.project_id, result.project_id))
    );
    expect(rows[0].project_root).toBe("/home/user/myrepo");
    expect(rows[0].worktree_prefix).toBe("/home/user/myrepo/.ysa/worktrees/");
  });

  test("validates project_root via agent when provided", async () => {
    await caller().projects.create({ name: "Wizard Project", project_root: "/home/user/myrepo" });
    const validateCalls = mockSendCommand.mock.calls.filter((c) => c[0] === "validatePath");
    expect(validateCalls).toHaveLength(1);
    expect(validateCalls[0][1]).toEqual({ path: "/home/user/myrepo" });
  });

  test("skips user settings when no project_root or env vars", async () => {
    const result = await caller().projects.create({ name: "Wizard Project" });
    const rows = await db.select().from(userProjectSettings).where(
      and(eq(userProjectSettings.user_id, TEST_USER_ID), eq(userProjectSettings.project_id, result.project_id))
    );
    expect(rows).toHaveLength(0);
  });
});

// ─── projects.update — buildTriggered (step 3) ───────────────────────────────

describe("projects.update — buildTriggered", () => {
  test("returns buildTriggered: false when languages unchanged", async () => {
    const result = await caller().projects.update({ projectId: TEST_PROJECT_ID, name: "Test Project" });
    expect(result.buildTriggered).toBe(false);
  });

  test("returns buildTriggered: true when languages require runtime installation", async () => {
    // python triggers tool installations via the real getMiseToolsForLanguages
    const result = await caller().projects.update({ projectId: TEST_PROJECT_ID, name: "Test Project", languages: '["python"]' });
    expect(result.buildTriggered).toBe(true);
    // restore
    await db.update(projects).set({ languages: null }).where(eq(projects.project_id, TEST_PROJECT_ID));
  });

  test("does not trigger build when languages change to empty", async () => {
    // First set a language
    await db.update(projects).set({ languages: '["node"]' }).where(eq(projects.project_id, TEST_PROJECT_ID));
    const result = await caller().projects.update({ projectId: TEST_PROJECT_ID, name: "Test Project", languages: null });
    expect(result.buildTriggered).toBe(false);
    // Restore
    await db.update(projects).set({ languages: null }).where(eq(projects.project_id, TEST_PROJECT_ID));
  });

  test("updates source fields (step 2)", async () => {
    const result = await caller().projects.update({
      projectId: TEST_PROJECT_ID,
      name: "Test Project",
      code_repo_url: "https://github.com/org/repo",
      issue_source: "github",
      default_branch: "develop",
      branch_prefix: "feat/",
    });
    expect(result.project.code_repo_url).toBe("https://github.com/org/repo");
    expect(result.project.issue_source).toBe("github");
    expect(result.project.default_branch).toBe("develop");
    expect(result.project.branch_prefix).toBe("feat/");
  });

  test("updates stack fields (step 3)", async () => {
    const result = await caller().projects.update({
      projectId: TEST_PROJECT_ID,
      name: "Test Project",
      install_cmd: "bun install",
      build_cmd: "bun run build",
      test_cmd: "bun test",
      pre_dev_cmd: "bun db:migrate",
      deps_cache_files: '["bun.lockb"]',
    });
    expect(result.project.install_cmd).toBe("bun install");
    expect(result.project.build_cmd).toBe("bun run build");
    expect(result.project.test_cmd).toBe("bun test");
    expect(result.project.pre_dev_cmd).toBe("bun db:migrate");
    expect(result.project.deps_cache_files).toBe('["bun.lockb"]');
  });

  test("updates worktree_files", async () => {
    const files = JSON.stringify([".env.local", ".npmrc"]);
    const result = await caller().projects.update({ projectId: TEST_PROJECT_ID, name: "Test Project", worktree_files: files });
    expect(result.project.worktree_files).toBe(files);
    // restore
    await db.update(projects).set({ worktree_files: null }).where(eq(projects.project_id, TEST_PROJECT_ID));
  });

  test("updates dev_servers JSON", async () => {
    const devServers = JSON.stringify([{ name: "api", command: "bun dev", port: 3000 }]);
    const result = await caller().projects.update({ projectId: TEST_PROJECT_ID, name: "Test Project", dev_servers: devServers });
    expect(result.project.dev_servers).toBe(devServers);
    // restore
    await db.update(projects).set({ dev_servers: null }).where(eq(projects.project_id, TEST_PROJECT_ID));
  });

  test("throws when project does not exist", async () => {
    await expect(
      caller().projects.update({ projectId: "nonexistent", name: "x" })
    ).rejects.toThrow();
  });
});

// ─── projects.updateUserSettings — personal settings (step 5) ────────────────

describe("projects.updateUserSettings — personal", () => {
  test("saves env_vars and mcp_config", async () => {
    await caller().projects.updateUserSettings({
      projectId: TEST_PROJECT_ID,
      env_vars: ".env,.env.local",
      mcp_config: "/home/user/.mcp.json",
    });
    const result = await caller().projects.getUserSettings({ projectId: TEST_PROJECT_ID });
    expect(result.env_vars).toBe(".env,.env.local");
    expect(result.mcp_config).toBe("/home/user/.mcp.json");
  });

  test("saves npmrc_path", async () => {
    await caller().projects.updateUserSettings({
      projectId: TEST_PROJECT_ID,
      npmrc_path: "/home/user/.npmrc",
    });
    const result = await caller().projects.getUserSettings({ projectId: TEST_PROJECT_ID });
    expect(result.npmrc_path).toBe("/home/user/.npmrc");
  });

  test("partial update preserves previously saved values", async () => {
    await caller().projects.updateUserSettings({
      projectId: TEST_PROJECT_ID,
      env_vars: ".env",
      npmrc_path: "~/.npmrc",
    });
    await caller().projects.updateUserSettings({
      projectId: TEST_PROJECT_ID,
      mcp_config: "/tmp/.mcp.json",
    });
    const result = await caller().projects.getUserSettings({ projectId: TEST_PROJECT_ID });
    expect(result.env_vars).toBe(".env");
    expect(result.npmrc_path).toBe("~/.npmrc");
    expect(result.mcp_config).toBe("/tmp/.mcp.json");
  });
});

// ─── projects.updateUserSettings — container settings (step 6) ───────────────

describe("projects.updateUserSettings — container", () => {
  test("saves all container resource fields", async () => {
    await caller().projects.updateUserSettings({
      projectId: TEST_PROJECT_ID,
      container_memory: "8g",
      container_cpus: 4,
      container_pids_limit: 1024,
      container_timeout: 7200,
    });
    const result = await caller().projects.getUserSettings({ projectId: TEST_PROJECT_ID });
    expect(result.container_memory).toBe("8g");
    expect(result.container_cpus).toBe(4);
    expect(result.container_pids_limit).toBe(1024);
    expect(result.container_timeout).toBe(7200);
  });

  test("partial container update preserves other fields", async () => {
    await caller().projects.updateUserSettings({
      projectId: TEST_PROJECT_ID,
      container_memory: "8g",
      container_cpus: 4,
    });
    await caller().projects.updateUserSettings({
      projectId: TEST_PROJECT_ID,
      container_pids_limit: 2048,
    });
    const result = await caller().projects.getUserSettings({ projectId: TEST_PROJECT_ID });
    expect(result.container_memory).toBe("8g");
    expect(result.container_cpus).toBe(4);
    expect(result.container_pids_limit).toBe(2048);
  });
});

// ─── wizard full flow (integration) ──────────────────────────────────────────

describe("wizard full flow — manual mode", () => {
  test("create → source → stack → personal → container", async () => {
    // Step 1: Create
    const created = await caller().projects.create({ name: "Flow Project" });
    const projectId = created.project_id;
    expect(projectId).toBe("flow-project");

    // Step 2: Source
    await caller().projects.update({
      projectId,
      name: "Flow Project",
      code_repo_url: "https://github.com/acme/app",
      issue_source: "github",
    });

    // Step 3: Stack (no language change → no build)
    const stackResult = await caller().projects.update({
      projectId,
      name: "Flow Project",
      install_cmd: "bun install",
      build_cmd: "bun run build",
      test_cmd: "bun test",
    });
    expect(stackResult.buildTriggered).toBe(false);

    // Step 5: Personal
    await caller().projects.updateUserSettings({
      projectId,
      env_vars: ".env",
    });

    // Step 6: Container
    await caller().projects.updateUserSettings({
      projectId,
      container_memory: "4g",
      container_cpus: 2,
      container_pids_limit: 512,
      container_timeout: 3600,
    });

    // Verify final project state
    const project = await caller().projects.get({ projectId });
    expect(project.code_repo_url).toBe("https://github.com/acme/app");
    expect(project.install_cmd).toBe("bun install");
    expect(project.build_cmd).toBe("bun run build");
    expect(project.test_cmd).toBe("bun test");

    // Verify user settings
    const userSettings = await caller().projects.getUserSettings({ projectId });
    expect(userSettings.env_vars).toBe(".env");
    expect(userSettings.container_memory).toBe("4g");
    expect(userSettings.container_cpus).toBe(2);
  });
});
