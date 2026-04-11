import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test";

// ── Mocks must be declared before any import of the tested modules ────────────

mock.module("../db", () => ({ db: (globalThis as any).__testDb }));

const mockSendCommand = mock((_cmd: string, _payload?: any, _timeoutMs?: number) =>
  Promise.resolve({ data: {} } as any)
);
const mockIsAgentConnected = mock(() => true);
const mockIsAgentConnectedForUser = mock(() => true);

mock.module("../ws/dispatch", () => ({
  sendCommand: mockSendCommand,
  isAgentConnected: mockIsAgentConnected,
  isAgentConnectedForUser: mockIsAgentConnectedForUser,
}));

mock.module("../lib/resources", () => ({
  getResourceMetrics: mock(() => Promise.resolve({ metrics: null })),
}));

mock.module("../lib/blockers", () => ({
  checkOpenBlockers: mock(() => Promise.resolve([])),
  buildBlockedByMap: mock(() => Promise.resolve({})),
}));

const mockGetProjectConfig = mock(() =>
  Promise.resolve({
    projectId: "test-project-001",
    projectRoot: "/tmp/test-project",
    worktreePrefix: "/tmp/worktrees/",
    branchPrefix: "fix/",
    installCmd: "",
    buildCmd: "",
    envFiles: [],
    worktreeFiles: [],
    devServers: [],
    mcpConfig: null,
    dashboardPort: 3333,
    issuesDir: process.env.ISSUES_DIR || "/tmp/ysa-test-issues",
    issueUrlTemplate: "",
    qaEnabled: false,
    testCmd: "",
    networkPolicy: "none" as const,
    llmProvider: "claude",
    llmModel: undefined,
    llmMaxTurns: 60,
    llmProviderKeys: {},
    issueSourceToken: null,
  })
);

mock.module("../lib/project-bootstrap", () => ({
  getProjectConfig: mockGetProjectConfig,
}));

// ── Now safe to import router ─────────────────────────────────────────────────

import { appRouter } from "./router";
import { seedBaseFixtures, seedTask, truncateTaskTables, TEST_USER_ID, TEST_ORG_ID, TEST_PROJECT_ID } from "../lib/test-helpers";
import { readStatus, getTaskWorkflowState } from "../lib/status";

function caller(userId = TEST_USER_ID, orgId = TEST_ORG_ID) {
  return appRouter.createCaller({ userId, orgId });
}

beforeAll(async () => { await seedBaseFixtures(); });

beforeEach(async () => {
  await truncateTaskTables();
  mockSendCommand.mockClear();
  mockIsAgentConnected.mockClear();
  mockIsAgentConnected.mockReturnValue(true);
  mockIsAgentConnectedForUser.mockClear();
  mockIsAgentConnectedForUser.mockReturnValue(true);
  mockSendCommand.mockImplementation((_cmd: string) => Promise.resolve({ data: {} }));
});

// ─── actions.init (source_type=prompt) ───────────────────────────────────────

describe("actions.init — source_type=prompt", () => {
  test("throws when agent not connected", async () => {
    mockIsAgentConnectedForUser.mockReturnValue(false);
    await expect(
      caller().actions.init({ source_type: "prompt", prompt: "Fix the login form", projectId: TEST_PROJECT_ID }),
    ).rejects.toThrow("Agent not connected");
  });

  test("throws when prompt is empty", async () => {
    await expect(
      caller().actions.init({ source_type: "prompt", prompt: "   ", projectId: TEST_PROJECT_ID }),
    ).rejects.toThrow("prompt is required");
  });

  test("creates a task row with source_type=prompt", async () => {
    const result = await caller().actions.init({
      source_type: "prompt",
      prompt: "Fix the login form",
      projectId: TEST_PROJECT_ID,
    });
    expect(result.ok).toBe(true);
    expect(result.initialized).toHaveLength(1);
    const taskId = result.initialized[0];
    const row = await readStatus(String(taskId));
    expect(row!.source_type).toBe("prompt");
    expect(row!.status).toBe("starting");
  });

  test("sets title from first non-empty line of prompt", async () => {
    const result = await caller().actions.init({
      source_type: "prompt",
      prompt: "Fix the login form\n\nMore details here",
      projectId: TEST_PROJECT_ID,
    });
    const row = await readStatus(String(result.initialized[0]));
    expect(row!.title).toBe("Fix the login form");
  });

  test("truncates title at 120 chars with ellipsis", async () => {
    const longTitle = "A".repeat(130);
    const result = await caller().actions.init({
      source_type: "prompt",
      prompt: longTitle,
      projectId: TEST_PROJECT_ID,
    });
    const row = await readStatus(String(result.initialized[0]));
    expect(row!.title!.length).toBeLessThanOrEqual(120);
    expect(row!.title!.endsWith("…")).toBe(true);
  });

  test("calls sendCommand('init') with the task id", async () => {
    const result = await caller().actions.init({
      source_type: "prompt",
      prompt: "Do something",
      projectId: TEST_PROJECT_ID,
    });
    const taskId = result.initialized[0];
    const initCall = mockSendCommand.mock.calls.find((c) => c[0] === "init");
    expect(initCall).toBeDefined();
    expect((initCall![1] as any).issues).toContain(taskId);
  });

  test("returns { ok: true, initialized: [id], skipped: [] }", async () => {
    const result = await caller().actions.init({
      source_type: "prompt",
      prompt: "Do something",
      projectId: TEST_PROJECT_ID,
    });
    expect(result.ok).toBe(true);
    expect(result.initialized).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  test("creates workflow state when workflow exists", async () => {
    const result = await caller().actions.init({
      source_type: "prompt",
      prompt: "Do something",
      projectId: TEST_PROJECT_ID,
    });
    const taskId = result.initialized[0];
    const state = await getTaskWorkflowState(String(taskId));
    expect(state).not.toBeNull();
  });
});

// ─── actions.init (source_type=provider) ─────────────────────────────────────

describe("actions.init — source_type=provider", () => {
  test("throws when agent not connected", async () => {
    mockIsAgentConnectedForUser.mockReturnValue(false);
    await expect(
      caller().actions.init({ source_type: "provider", issues: [100] }),
    ).rejects.toThrow("Agent not connected");
  });

  test("throws when issues array is empty", async () => {
    await expect(
      caller().actions.init({ source_type: "provider", issues: [] }),
    ).rejects.toThrow("issues is required");
  });

  test("writes a task row with source_type=provider", async () => {
    mockSendCommand.mockImplementation((cmd: string) => {
      if (cmd === "checkIssue") return Promise.resolve({ data: { worktreeExists: false, branchExists: false } });
      return Promise.resolve({ data: {} });
    });
    const result = await caller().actions.init({
      source_type: "provider",
      issues: [500],
      projectId: TEST_PROJECT_ID,
    });
    expect(result.initialized).toContain(500);
    const row = await readStatus("500");
    expect(row!.source_type).toBe("provider");
  });

  test("skips task when checkIssue returns worktreeExists and cleanup fails", async () => {
    mockSendCommand.mockImplementation((cmd: string) => {
      if (cmd === "checkIssue") return Promise.resolve({ data: { worktreeExists: true, branchExists: false } });
      if (cmd === "cleanup") return Promise.reject(new Error("cleanup failed"));
      return Promise.resolve({ data: {} });
    });
    const result = await caller().actions.init({
      source_type: "provider",
      issues: [501],
      projectId: TEST_PROJECT_ID,
    });
    expect(result.skipped.some((s: any) => s.id === 501)).toBe(true);
    expect(result.initialized).not.toContain(501);
  });
});

// ─── actions.stop ─────────────────────────────────────────────────────────────

describe("actions.stop", () => {
  test("throws when task not found", async () => {
    await expect(caller().actions.stop({ id: "9999" })).rejects.toThrow();
  });

  test("throws when task is not running or starting", async () => {
    await seedTask(1001, { status: "failed" });
    await expect(caller().actions.stop({ id: "1001" })).rejects.toThrow("not running");
  });

  test("calls sendCommand('stop') and patches status to stopped", async () => {
    mockSendCommand.mockImplementation((cmd: string) => {
      if (cmd === "stop") return Promise.resolve({ data: { sessionId: "sess-abc" } });
      return Promise.resolve({ data: {} });
    });
    await seedTask(1001, { status: "running" });
    await caller().actions.stop({ id: "1001" });
    const row = await readStatus("1001");
    expect(row!.status).toBe("stopped");
    expect(row!.session_id).toBe("sess-abc");
  });

  test("preserves existing session_id when ack has none", async () => {
    mockSendCommand.mockImplementation(() => Promise.resolve({ data: {} }));
    await seedTask(1001, { status: "running", session_id: "existing-sess" });
    await caller().actions.stop({ id: "1001" });
    const row = await readStatus("1001");
    expect(row!.session_id).toBe("existing-sess");
  });
});

// ─── actions.resolve ──────────────────────────────────────────────────────────

describe("actions.resolve", () => {
  test("throws when task not found", async () => {
    await expect(caller().actions.resolve({ id: "9999" })).rejects.toThrow();
  });

  test("throws when task status is not stopped", async () => {
    await seedTask(1001, { status: "running" });
    await expect(caller().actions.resolve({ id: "1001" })).rejects.toThrow("stopped");
  });

  test("throws when task has no workflow state", async () => {
    await seedTask(1001, { status: "stopped" });
    await expect(caller().actions.resolve({ id: "1001" })).rejects.toThrow("workflow state");
  });

  test("patches status to step_done", async () => {
    await seedTask(1001, { status: "stopped" });
    await createTaskWorkflowState("1001");
    await caller().actions.resolve({ id: "1001" });
    const row = await readStatus("1001");
    expect(row!.status).toBe("step_done");
  });

  test("returns { ok: true, message: 'Marked as step_done' }", async () => {
    await seedTask(1001, { status: "stopped" });
    await createTaskWorkflowState("1001");
    const result = await caller().actions.resolve({ id: "1001" });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Marked as step_done");
  });
});

// ─── actions.delete ───────────────────────────────────────────────────────────

describe("actions.delete", () => {
  test("throws FORBIDDEN when caller is not owner/admin and did not create the task", async () => {
    // Seed a task created by user 1
    await seedTask(1001, { status: "stopped", created_by: TEST_USER_ID });
    // Create a second user (non-admin member)
    const { db } = await import("../db");
    const { users, orgMembers } = await import("../db/schema");
    await db.insert(users).values({ id: 99, email: "other@example.com", password_hash: "x" }).onConflictDoNothing();
    await db.insert(orgMembers).values({ user_id: 99, org_id: TEST_ORG_ID, role: "member" }).onConflictDoNothing();

    await expect(caller(99, TEST_ORG_ID).actions.delete({ id: "1001" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("owner can delete any task", async () => {
    await seedTask(1001, { status: "stopped" });
    const result = await caller().actions.delete({ id: "1001" });
    expect(result.ok).toBe(true);
    expect(await readStatus("1001")).toBeNull();
  });

  test("calls sendCommand stop + cleanup when agent connected", async () => {
    await seedTask(1001, { status: "stopped" });
    await caller().actions.delete({ id: "1001" });
    const cmds = mockSendCommand.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("stop");
    expect(cmds).toContain("cleanup");
  });

  test("still deletes DB row even if sendCommand throws", async () => {
    mockSendCommand.mockImplementation(() => Promise.reject(new Error("agent error")));
    await seedTask(1001, { status: "stopped" });
    const result = await caller().actions.delete({ id: "1001" });
    expect(result.ok).toBe(true);
    expect(await readStatus("1001")).toBeNull();
  });
});

// Helper: create a minimal workflow state for a task
async function createTaskWorkflowState(taskId: string) {
  const { createTaskWorkflowState: create } = await import("../lib/status");
  await create(taskId, 1, null, { id: 1, name: "Test", steps: [], transitions: [] });
}
