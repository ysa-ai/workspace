import { db } from "../db";
import { tasks, stepPrompts, taskWorkflowStates, workflowSteps, stepResults, stepModuleData } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";

// ─── Tasks ──────────────────────────────────────────────────────────────

export async function readStuckTasks() {
  return db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ["running", "starting"]));
}


export async function readStatus(taskId: string) {
  const row = (await db
    .select()
    .from(tasks)
    .where(eq(tasks.task_id, parseInt(taskId))))[0];
  return row || null;
}

export async function writeStatus(taskId: string, data: Record<string, unknown>) {
  const id = parseInt(taskId);

  await db.insert(tasks)
    .values({ task_id: id, ...data } as any)
    .onConflictDoUpdate({
      target: tasks.task_id,
      set: { ...data, updated_at: new Date().toISOString() } as any,
    });
}

export async function patchStatus(taskId: string, updates: Record<string, unknown>) {
  const id = parseInt(taskId);

  await db.update(tasks)
    .set({ ...updates, updated_at: new Date().toISOString() } as any)
    .where(eq(tasks.task_id, id));

  return (await db.select().from(tasks).where(eq(tasks.task_id, id)))[0];
}

// ─── Step Prompts ────────────────────────────────────────────────────────

export async function upsertStepPrompt(taskId: string, stepSlug: string, content: string) {
  const id = parseInt(taskId);

  await db.delete(stepPrompts)
    .where(and(eq(stepPrompts.task_id, id), eq(stepPrompts.step_slug, stepSlug)));

  await db.insert(stepPrompts)
    .values({ task_id: id, step_slug: stepSlug, content });
}

export async function readStepPrompt(taskId: string, stepSlug: string): Promise<string | null> {
  const row = (await db
    .select({ content: stepPrompts.content })
    .from(stepPrompts)
    .where(and(eq(stepPrompts.task_id, parseInt(taskId)), eq(stepPrompts.step_slug, stepSlug))))[0];
  return row?.content ?? null;
}

// ─── Delete ─────────────────────────────────────────────────────────────

export async function deleteTask(taskId: string) {
  const id = parseInt(taskId);
  await db.delete(stepPrompts).where(eq(stepPrompts.task_id, id));
  await db.delete(stepResults).where(eq(stepResults.task_id, id));
  await db.delete(stepModuleData).where(eq(stepModuleData.task_id, id));
  await db.delete(taskWorkflowStates).where(eq(taskWorkflowStates.task_id, id));
  await db.delete(tasks).where(eq(tasks.task_id, id));
}

// ─── Workflow State ───────────────────────────────────────────────────────

export async function getTaskWorkflowState(taskId: string) {
  return (await db
    .select()
    .from(taskWorkflowStates)
    .where(eq(taskWorkflowStates.task_id, parseInt(taskId))))[0] ?? null;
}

export async function createTaskWorkflowState(
  taskId: string,
  workflowId: number,
  stepId: number | null,
  snapshot: object,
) {
  const id = parseInt(taskId);
  await db.insert(taskWorkflowStates)
    .values({
      task_id: id,
      workflow_id: workflowId,
      current_step_id: stepId,
      workflow_snapshot: JSON.stringify(snapshot),
      step_history: "[]",
    })
    .onConflictDoUpdate({
      target: taskWorkflowStates.task_id,
      set: {
        workflow_id: workflowId,
        current_step_id: stepId,
        workflow_snapshot: JSON.stringify(snapshot),
        updated_at: new Date().toISOString(),
      },
    });
}

export async function advanceWorkflowState(
  taskId: string,
  transitionId: number,
  newStepSlug: string,
  now: string,
) {
  const id = parseInt(taskId);
  const state = (await db
    .select()
    .from(taskWorkflowStates)
    .where(eq(taskWorkflowStates.task_id, id)))[0];
  if (!state) return;

  // Find new step in snapshot
  let newStepId: number | null = null;
  try {
    const snapshot = JSON.parse(state.workflow_snapshot) as { steps: { id: number; slug: string }[] };
    const step = snapshot.steps.find((s) => s.slug === newStepSlug);
    newStepId = step?.id ?? null;
  } catch { /* snapshot parse error */ }

  // Mark current step done in history
  let history: any[] = [];
  try { history = JSON.parse(state.step_history); } catch { /* */ }
  if (state.current_step_id) {
    const existing = history.find((h: any) => h.stepId === state.current_step_id);
    if (existing) {
      existing.finishedAt = now;
      existing.status = "done";
    }
  }
  // Add new step to history
  if (newStepId) {
    history.push({ stepId: newStepId, slug: newStepSlug, startedAt: now, finishedAt: null, status: "running" });
  }

  await db.update(taskWorkflowStates)
    .set({
      current_step_id: newStepId,
      step_history: JSON.stringify(history),
      updated_at: now,
    })
    .where(eq(taskWorkflowStates.task_id, id));
}

export async function markWorkflowStepComplete(taskId: string, stepId: number, now: string, status: "done" | "failed") {
  const id = parseInt(taskId);
  const state = (await db
    .select()
    .from(taskWorkflowStates)
    .where(eq(taskWorkflowStates.task_id, id)))[0];
  if (!state) return;

  let history: any[] = [];
  try { history = JSON.parse(state.step_history); } catch { /* */ }
  const entry = history.find((h: any) => h.stepId === stepId);
  if (entry) {
    entry.finishedAt = now;
    entry.status = status;
  }

  await db.update(taskWorkflowStates)
    .set({ step_history: JSON.stringify(history), updated_at: now })
    .where(eq(taskWorkflowStates.task_id, id));
}
