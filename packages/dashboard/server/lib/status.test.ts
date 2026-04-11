import { mock, describe, test, expect, beforeAll, beforeEach } from "bun:test";

mock.module("../db", () => ({ db: (globalThis as any).__testDb }));
import {
  readStatus,
  writeStatus,
  patchStatus,
  upsertStepPrompt,
  readStepPrompt,
  getTaskWorkflowState,
  createTaskWorkflowState,
  advanceWorkflowState,
  markWorkflowStepComplete,
  deleteTask,
} from "./status";
import { seedBaseFixtures, seedTask, truncateTaskTables, TEST_PROJECT_ID, TEST_USER_ID } from "./test-helpers";

beforeAll(async () => { await seedBaseFixtures(); });
beforeEach(async () => { await truncateTaskTables(); });

// ─── writeStatus / readStatus ─────────────────────────────────────────────────

describe("writeStatus / readStatus", () => {
  test("returns null for non-existent taskId", async () => {
    expect(await readStatus("9999")).toBeNull();
  });

  test("creates a task row and reads it back", async () => {
    await writeStatus("1001", {
      task_id: 1001,
      project_id: TEST_PROJECT_ID,
      step: "analyze",
      status: "running",
      source_type: "provider",
      started_at: "2026-01-01T00:00:00.000Z",
      created_by: TEST_USER_ID,
    });
    const row = await readStatus("1001");
    expect(row).not.toBeNull();
    expect(row!.task_id).toBe(1001);
    expect(row!.status).toBe("running");
    expect(row!.step).toBe("analyze");
  });

  test("upserts: second write updates the row", async () => {
    await writeStatus("1001", { task_id: 1001, project_id: TEST_PROJECT_ID, step: "analyze", status: "running", source_type: "provider", created_by: TEST_USER_ID });
    await writeStatus("1001", { task_id: 1001, project_id: TEST_PROJECT_ID, step: "execute", status: "failed", source_type: "provider", created_by: TEST_USER_ID });
    const row = await readStatus("1001");
    expect(row!.status).toBe("failed");
    expect(row!.step).toBe("execute");
  });

  test("stores source_type=prompt", async () => {
    await writeStatus("1002", {
      task_id: 1002, project_id: TEST_PROJECT_ID, step: "analyze",
      status: "starting", source_type: "prompt", created_by: TEST_USER_ID,
    });
    const row = await readStatus("1002");
    expect(row!.source_type).toBe("prompt");
  });

  test("stores title", async () => {
    await writeStatus("1003", {
      task_id: 1003, project_id: TEST_PROJECT_ID, step: "analyze",
      status: "starting", source_type: "prompt", title: "Fix the login form", created_by: TEST_USER_ID,
    });
    const row = await readStatus("1003");
    expect(row!.title).toBe("Fix the login form");
  });
});

// ─── patchStatus ─────────────────────────────────────────────────────────────

describe("patchStatus", () => {
  test("patches a single field", async () => {
    await seedTask(1001);
    await patchStatus("1001", { status: "running" });
    const row = await readStatus("1001");
    expect(row!.status).toBe("running");
  });

  test("returns the updated row", async () => {
    await seedTask(1001);
    const row = await patchStatus("1001", { status: "failed" });
    expect(row!.status).toBe("failed");
  });

  test("patching non-existent task does not throw", async () => {
    await patchStatus("9999", { status: "running" });
  });
});

// ─── upsertStepPrompt / readStepPrompt ────────────────────────────────────────

describe("upsertStepPrompt / readStepPrompt", () => {
  test("readStepPrompt returns null when no prompt exists", async () => {
    await seedTask(1001);
    expect(await readStepPrompt("1001", "analyze")).toBeNull();
  });

  test("upsertStepPrompt creates a prompt and readStepPrompt returns it", async () => {
    await seedTask(1001);
    await upsertStepPrompt("1001", "analyze", "Do the thing.");
    expect(await readStepPrompt("1001", "analyze")).toBe("Do the thing.");
  });

  test("upsertStepPrompt updates existing prompt content", async () => {
    await seedTask(1001);
    await upsertStepPrompt("1001", "analyze", "v1");
    await upsertStepPrompt("1001", "analyze", "v2");
    expect(await readStepPrompt("1001", "analyze")).toBe("v2");
  });
});

// ─── createTaskWorkflowState / getTaskWorkflowState ──────────────────────────

describe("createTaskWorkflowState / getTaskWorkflowState", () => {
  test("returns null for unknown task", async () => {
    expect(await getTaskWorkflowState("9999")).toBeNull();
  });

  test("creates workflow state and reads it back", async () => {
    await seedTask(1001);
    const snapshot = { id: 1, name: "Test", steps: [], transitions: [] };
    await createTaskWorkflowState("1001", 1, 10, snapshot);
    const state = await getTaskWorkflowState("1001");
    expect(state).not.toBeNull();
    expect(state!.workflow_id).toBe(1);
    expect(state!.current_step_id).toBe(10);
  });

  test("workflow_snapshot is parseable JSON", async () => {
    await seedTask(1001);
    const snapshot = { id: 1, name: "Test", steps: [{ id: 10, slug: "analyze" }], transitions: [] };
    await createTaskWorkflowState("1001", 1, 10, snapshot);
    const state = await getTaskWorkflowState("1001");
    const parsed = JSON.parse(state!.workflow_snapshot);
    expect(parsed.steps[0].slug).toBe("analyze");
  });

  test("step_history starts as empty array", async () => {
    await seedTask(1001);
    await createTaskWorkflowState("1001", 1, 10, {});
    const state = await getTaskWorkflowState("1001");
    expect(JSON.parse(state!.step_history)).toEqual([]);
  });
});

// ─── advanceWorkflowState ─────────────────────────────────────────────────────

describe("advanceWorkflowState", () => {
  test("no-op when task has no workflow state", async () => {
    await seedTask(1001);
    await advanceWorkflowState("1001", 1, "execute", new Date().toISOString());
  });

  test("updates current_step_id to the new step", async () => {
    await seedTask(1001);
    const snapshot = {
      id: 1, name: "Test",
      steps: [{ id: 10, slug: "analyze" }, { id: 11, slug: "execute" }],
      transitions: [{ id: 1, fromStepId: 10, toStepId: 11 }],
    };
    await createTaskWorkflowState("1001", 1, 10, snapshot);
    const now = new Date().toISOString();
    await advanceWorkflowState("1001", 1, "execute", now);
    const state = await getTaskWorkflowState("1001");
    expect(state!.current_step_id).toBe(11);
  });

  test("marks previous step as done and appends new step entry", async () => {
    await seedTask(1001);
    const snapshot = {
      id: 1, name: "Test",
      steps: [{ id: 10, slug: "analyze" }, { id: 11, slug: "execute" }],
      transitions: [],
    };
    await createTaskWorkflowState("1001", 1, 10, snapshot);
    const { db } = await import("../db");
    const { taskWorkflowStates } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const history = [{ stepId: 10, slug: "analyze", startedAt: "2026-01-01T00:00:00Z", finishedAt: null, status: "running" }];
    await db.update(taskWorkflowStates)
      .set({ step_history: JSON.stringify(history) })
      .where(eq(taskWorkflowStates.task_id, 1001));

    const now = "2026-01-01T01:00:00Z";
    await advanceWorkflowState("1001", 1, "execute", now);
    const state = await getTaskWorkflowState("1001");
    const hist = JSON.parse(state!.step_history);
    expect(hist[0].finishedAt).toBe(now);
    expect(hist[0].status).toBe("done");
    expect(hist[1].slug).toBe("execute");
    expect(hist[1].status).toBe("running");
  });
});

// ─── markWorkflowStepComplete ─────────────────────────────────────────────────

describe("markWorkflowStepComplete", () => {
  test("no-op when task has no workflow state", async () => {
    await markWorkflowStepComplete("9999", 10, new Date().toISOString(), "done");
  });

  test("sets finishedAt and status=done on the step", async () => {
    await seedTask(1001);
    await createTaskWorkflowState("1001", 1, 10, {});
    const { db } = await import("../db");
    const { taskWorkflowStates } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const history = [{ stepId: 10, slug: "analyze", startedAt: "2026-01-01T00:00:00Z", finishedAt: null, status: "running" }];
    await db.update(taskWorkflowStates)
      .set({ step_history: JSON.stringify(history) })
      .where(eq(taskWorkflowStates.task_id, 1001));

    const now = "2026-01-01T01:00:00Z";
    await markWorkflowStepComplete("1001", 10, now, "done");
    const state = await getTaskWorkflowState("1001");
    const hist = JSON.parse(state!.step_history);
    expect(hist[0].finishedAt).toBe(now);
    expect(hist[0].status).toBe("done");
  });

  test("sets status=failed when passed failed", async () => {
    await seedTask(1001);
    await createTaskWorkflowState("1001", 1, 10, {});
    const { db } = await import("../db");
    const { taskWorkflowStates } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const history = [{ stepId: 10, slug: "analyze", startedAt: "2026-01-01T00:00:00Z", finishedAt: null, status: "running" }];
    await db.update(taskWorkflowStates)
      .set({ step_history: JSON.stringify(history) })
      .where(eq(taskWorkflowStates.task_id, 1001));

    await markWorkflowStepComplete("1001", 10, new Date().toISOString(), "failed");
    const state = await getTaskWorkflowState("1001");
    expect(JSON.parse(state!.step_history)[0].status).toBe("failed");
  });
});

// ─── deleteTask ───────────────────────────────────────────────────────────────

describe("deleteTask", () => {
  test("removes task row", async () => {
    await seedTask(1001);
    await deleteTask("1001");
    expect(await readStatus("1001")).toBeNull();
  });

  test("cascades to step_prompts table", async () => {
    await seedTask(1001);
    await upsertStepPrompt("1001", "analyze", "my prompt");
    await deleteTask("1001");
    expect(await readStepPrompt("1001", "analyze")).toBeNull();
  });

  test("removes workflow state", async () => {
    await seedTask(1001);
    await createTaskWorkflowState("1001", 1, 10, {});
    await deleteTask("1001");
    expect(await getTaskWorkflowState("1001")).toBeNull();
  });

  test("does not throw when task does not exist", async () => {
    await deleteTask("9999");
  });
});
