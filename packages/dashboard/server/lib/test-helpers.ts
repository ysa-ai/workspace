import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  orgMembers,
  projects,
  workflows,
  workflowSteps,
  workflowTransitions,
} from "../db/schema";

export const TEST_ORG_ID = 1;
export const TEST_USER_ID = 1;
export const TEST_PROJECT_ID = "test-project-001";

export function makeCtx(overrides?: Partial<{ userId: number; orgId: number }>) {
  return { userId: TEST_USER_ID, orgId: TEST_ORG_ID, ...overrides };
}

export async function seedBaseFixtures() {
  await db.insert(organizations)
    .values({ id: TEST_ORG_ID, name: "Test Org" })
    .onConflictDoNothing();

  await db.insert(users)
    .values({ id: TEST_USER_ID, email: "test@example.com", password_hash: "x" })
    .onConflictDoNothing();

  await db.insert(orgMembers)
    .values({ user_id: TEST_USER_ID, org_id: TEST_ORG_ID, role: "owner" })
    .onConflictDoNothing();

  await db.insert(projects)
    .values({
      project_id: TEST_PROJECT_ID,
      name: "Test Project",
      org_id: TEST_ORG_ID,
    })
    .onConflictDoNothing();

  // Minimal 2-step workflow (analyze → execute)
  const [wf] = await db.insert(workflows)
    .values({ id: 1, name: "Test Workflow", is_builtin: true })
    .onConflictDoUpdate({ target: workflows.id, set: { name: "Test Workflow" } })
    .returning();

  const [step1] = await db.insert(workflowSteps)
    .values({
      workflow_id: wf.id,
      name: "Analyze",
      slug: "analyze",
      position: 1,
      modules: "[]",
      tool_preset: "readonly",
      container_mode: "readonly",
      prompt_template: "Analyze the issue.",
    })
    .onConflictDoNothing()
    .returning();

  const [step2] = await db.insert(workflowSteps)
    .values({
      workflow_id: wf.id,
      name: "Execute",
      slug: "execute",
      position: 2,
      modules: "[]",
      tool_preset: "readwrite",
      container_mode: "readwrite",
      prompt_template: "Execute the plan.",
    })
    .onConflictDoNothing()
    .returning();

  if (step1 && step2) {
    await db.insert(workflowTransitions)
      .values({
        from_step_id: step1.id,
        to_step_id: step2.id,
        label: "Execute",
        is_default: true,
        position: 0,
      })
      .onConflictDoNothing();
  }

  return { workflowId: wf.id, step1, step2 };
}

export async function truncateTaskTables() {
  // task_workflow_states, step_results, step_module_data have no FK to tasks
  // so we truncate them explicitly alongside tasks (which cascades to plans, qa_criteria, etc.)
  await db.execute(
    sql`TRUNCATE tasks, task_workflow_states, step_results, step_module_data, step_prompts RESTART IDENTITY CASCADE`,
  );
}

export async function seedTask(taskId: number, overrides: Record<string, unknown> = {}) {
  const { writeStatus } = await import("./status");
  await writeStatus(String(taskId), {
    task_id: taskId,
    project_id: TEST_PROJECT_ID,
    step: "analyze",
    status: "stopped",
    source_type: "provider",
    started_at: new Date().toISOString(),
    finished_at: null,
    pid: null,
    session_id: null,
    plan_summary: null,
    mr_url: null,
    error: null,
    created_by: TEST_USER_ID,
    ...overrides,
  });
}
