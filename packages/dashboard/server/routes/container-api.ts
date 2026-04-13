import type { Hono } from "hono";
import { db } from "../db";
import { submitTokens, tasks, stepResults, stepModuleData } from "../db/schema";
import { eq, and, lt } from "drizzle-orm";
import { verifyAccessToken } from "../lib/auth";
import { sha256 } from "../lib/auth-helpers";
import { readStatus, readStepPrompt, getTaskWorkflowState } from "../lib/status";
import { getProjectConfig } from "../lib/project-bootstrap";
import { sendCommand, isAgentConnectedForUser } from "../ws/dispatch";

async function getUserIdForTask(taskId: string): Promise<number | undefined> {
  const [row] = await db.select({ created_by: tasks.created_by }).from(tasks)
    .where(eq(tasks.task_id, parseInt(taskId))).limit(1);
  return row?.created_by ?? undefined;
}

export async function validateSubmitToken(c: any, issueId: number): Promise<boolean> {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const hash = await sha256(token);
  const now = Date.now();
  await db.delete(submitTokens).where(lt(submitTokens.expires_at, now));
  const rows = await db.select().from(submitTokens)
    .where(and(eq(submitTokens.token_hash, hash), eq(submitTokens.task_id, issueId)))
    .limit(1);
  if (rows.length === 0) return false;
  if (rows[0].project_id === "") return true;
  const status = await readStatus(String(issueId));
  if (!status?.project_id) return false;
  return rows[0].project_id === status.project_id;
}

export function registerContainerApiRoutes(app: Hono): void {
  app.post("/api/tasks/:id/result", async (c) => {
    const id = c.req.param("id");
    if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.text();
    let data: Record<string, any>;
    try {
      data = JSON.parse(body);
    } catch {
      data = { raw: body };
    }
    try {
      const status = await readStatus(id);
      if (status?.project_id) {
        const userId = await getUserIdForTask(id);
        if (userId && isAgentConnectedForUser(userId)) {
          const cfg = await getProjectConfig(status.project_id, userId);
          if (cfg.worktreePrefix) {
            const worktree = `${cfg.worktreePrefix}${id}`;
            const ack = await sendCommand("get_git_info", { worktree }, 10000);
            if (ack.ok && ack.data) Object.assign(data, ack.data);
          }
        }
      }
    } catch {
      // best-effort
    }
    await db.insert(stepResults)
      .values({ task_id: parseInt(id), step_id: 0, result_type: "detect", content: JSON.stringify(data) })
      .onConflictDoUpdate({
        target: [stepResults.task_id, stepResults.step_id],
        set: { content: JSON.stringify(data), updated_at: new Date().toISOString() },
      });
    return c.json({ ok: true });
  });

  app.get("/api/tasks/:id/result", async (c) => {
    const id = c.req.param("id");
    if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
    const row = (await db.select().from(stepResults)
      .where(and(eq(stepResults.task_id, parseInt(id)), eq(stepResults.step_id, 0))))[0];
    if (!row?.content) return c.text("", 404);
    try { return c.json(JSON.parse(row.content)); } catch { return c.text(row.content); }
  });

  app.get("/api/tasks/:id/prompt", async (c) => {
    const id = c.req.param("id");
    if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
    const step = c.req.query("step");
    if (!step) return c.text("", 404);
    const content = await readStepPrompt(id, step);
    if (!content) return c.text("", 404);
    return c.text(content);
  });

  app.post("/api/tasks/:id/steps/:slug/result", async (c) => {
    const id = c.req.param("id");
    if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
    const slug = c.req.param("slug");
    const body = await c.req.text();

    const state = await getTaskWorkflowState(id);
    const stepId = state ? (() => {
      try {
        const snapshot = JSON.parse(state.workflow_snapshot);
        return snapshot.steps?.find((s: any) => s.slug === slug)?.id ?? 0;
      } catch { return 0; }
    })() : 0;

    await db.insert(stepResults)
      .values({ task_id: parseInt(id), step_id: stepId, result_type: "step", content: body })
      .onConflictDoUpdate({
        target: [stepResults.task_id, stepResults.step_id],
        set: { content: body, updated_at: new Date().toISOString() },
      });
    return c.json({ ok: true });
  });

  app.post("/api/tasks/:id/steps/:slug/module/:module", async (c) => {
    const id = c.req.param("id");
    if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
    const slug = c.req.param("slug");
    const module = c.req.param("module");
    const body = await c.req.text();

    const state = await getTaskWorkflowState(id);
    if (!state) return c.json({ ok: true });

    try {
      const snapshot = JSON.parse(state.workflow_snapshot);
      const step = snapshot.steps?.find((s: any) => s.slug === slug);
      if (step) {
        await db.insert(stepModuleData)
          .values({ task_id: parseInt(id), step_id: step.id, module, data: body })
          .onConflictDoUpdate({
            target: [stepModuleData.task_id, stepModuleData.step_id, stepModuleData.module],
            set: { data: body, updated_at: new Date().toISOString() },
          });
      }
    } catch { /* */ }
    return c.json({ ok: true });
  });
}
