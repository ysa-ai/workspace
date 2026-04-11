import { z } from "zod";
import { router, protectedProcedure as publicProcedure } from "./init";
import { getProjectConfig } from "../lib/project-bootstrap";
import { buildBlockedByMap } from "../lib/blockers";
import { readStatus, patchStatus, getTaskWorkflowState } from "../lib/status";
import { parseLogEntry, mergeToolOutputs } from "@ysa-ai/shared";
import { db } from "../db";
import { tasks, taskWorkflowStates, stepModuleData, stepResults, projects, userProjectSettings } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireProjectAccess, requireTaskAccess } from "../lib/auth-guard";
import { sendCommand, isAgentConnectedForUser } from "../ws/dispatch";
import { normalizeResult } from "./task-utils";

async function enrichStatus(id: string, status: any) {
  // Workflow state enrichment
  const wfState = await getTaskWorkflowState(id);
  if (wfState) {
    try {
      const snapshot = JSON.parse(wfState.workflow_snapshot) as { steps: any[]; transitions: any[] };
      const stepId = wfState.current_step_id;
      const currentStep = stepId ? snapshot.steps?.find((s: any) => s.id === stepId) ?? null : null;

      status.workflow_steps = (snapshot.steps ?? []).map((s: any) => ({
        id: s.id, slug: s.slug, name: s.name, position: s.position,
        modules: s.modules ?? [],
      }));
      status.current_step_slug = currentStep?.slug ?? status.step;
      status.current_step_name = currentStep?.name ?? status.step;

      // Transitions from current step
      if (stepId) {
        status.step_transitions = (snapshot.transitions ?? [])
          .filter((t: any) => t.fromStepId === stepId)
          .map((t: any) => ({
            id: t.id,
            toStepId: t.toStepId,
            label: t.label,
            isDefault: t.isDefault,
          }));
      } else {
        status.step_transitions = [];
      }

      status.step_history = (() => { try { return JSON.parse(wfState.step_history); } catch { return []; } })();
    } catch { /* snapshot parse error */ }
  }

  // Derive available logs from step history — if a step started, the agent wrote logs for it
  const history: any[] = (() => { try { return JSON.parse(wfState?.step_history ?? "[]"); } catch { return []; } })();
  const availLogs = history.filter((h: any) => h.startedAt).map((h: any) => h.slug);
  status.has_log = availLogs.length > 0 || ["running", "starting", "done", "failed"].includes(status.status);
  status.available_logs = availLogs;
  const cfg = await getProjectConfig(status.project_id ?? null);
  if (cfg.issueUrlTemplate && status.source_type !== "prompt") {
    status.issue_url = cfg.issueUrlTemplate.replace("{id}", String(status.task_id));
  }
  status.llm_provider = cfg.llmProvider;
  status.llm_model = cfg.llmModel ?? null;
  status.issue_source = cfg.issueSource ?? "gitlab";
  return status;
}

export const tasksRouter = router({
  config: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const cfg = await getProjectConfig(input?.projectId ?? null, ctx.userId);
      const tpl = cfg.issueUrlTemplate || "";
      let repoLabel = "";
      try {
        const url = new URL(tpl.replace("{id}", "0"));
        const parts = url.pathname.split("/-/")[0];
        repoLabel = url.host + parts;
      } catch {
        repoLabel = cfg.projectRoot.split("/").slice(-1)[0] || "";
      }
      return { projectRoot: cfg.projectRoot, issueUrlTemplate: tpl, repoLabel };
    }),

  prompt: publicProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      const row = (await db.select({ prompt: tasks.prompt }).from(tasks).where(eq(tasks.task_id, input.taskId)))[0];
      return { prompt: row?.prompt ?? null };
    }),

  list: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      let rows;
      if (input?.projectId) {
        await requireProjectAccess(ctx.orgId, input.projectId);
        rows = await db
          .select()
          .from(tasks)
          .where(eq(tasks.project_id, input.projectId))
          .orderBy(tasks.task_id);
      } else {
        const orgProjects = await db.select({ project_id: projects.project_id })
          .from(projects)
          .where(eq(projects.org_id, ctx.orgId));
        const orgProjectIds = orgProjects.map((p) => p.project_id);
        if (orgProjectIds.length === 0) return [];
        rows = await db.select().from(tasks)
          .where(inArray(tasks.project_id, orgProjectIds))
          .orderBy(tasks.task_id);
      }
      const enriched = [];
      for (const row of rows) {
        enriched.push(await enrichStatus(String(row.task_id), { ...row }));
      }
      return enriched;
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);
      return enrichStatus(input.id, { ...status });
    }),

  plan: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      // Check step module data first (new workflow approach)
      const wfState = await getTaskWorkflowState(input.id);
      if (wfState) {
        try {
          const snapshot = JSON.parse(wfState.workflow_snapshot);
          const planStep = snapshot.steps?.find((s: any) =>
            Array.isArray(s.modules) && s.modules.some((m: any) => m.name === "plan"),
          );
          if (planStep) {
            const row = (await db.select().from(stepModuleData)
              .where(and(
                eq(stepModuleData.task_id, parseInt(input.id)),
                eq(stepModuleData.step_id, planStep.id),
                eq(stepModuleData.module, "plan"),
              )))[0];
            if (row?.data) return row.data;
          }
        } catch { /* snapshot error */ }
      }

      return null;
    }),

  result: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      const row = (await db.select().from(stepResults)
        .where(and(eq(stepResults.task_id, parseInt(input.id)), eq(stepResults.step_id, 0))))[0];
      if (!row?.content) throw new Error(`No result for task ${input.id}`);
      try { return normalizeResult(JSON.parse(row.content) as Record<string, any>); } catch { return null; }
    }),

  stepResult: publicProcedure
    .input(z.object({ id: z.string(), stepSlug: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      const wfState = await getTaskWorkflowState(input.id);
      if (!wfState) throw new Error(`No workflow state for task ${input.id}`);
      const snapshot = JSON.parse(wfState.workflow_snapshot);
      const step = snapshot.steps?.find((s: any) => s.slug === input.stepSlug);
      if (!step) throw new Error(`Step ${input.stepSlug} not found`);
      const row = (await db.select().from(stepResults)
        .where(and(eq(stepResults.task_id, parseInt(input.id)), eq(stepResults.step_id, step.id))))[0];
      if (!row?.content) throw new Error(`No result for step ${input.stepSlug}`);
      try { return JSON.parse(row.content) as Record<string, any>; } catch { return null; }
    }),

  browse: publicProcedure
    .input(z.object({ projectId: z.string(), query: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      const cfg = await getProjectConfig(input.projectId, ctx.userId);
      const source = cfg.issueSource ?? "gitlab";
      const tpl = cfg.issueUrlTemplate;
      if (!tpl) return { tasks: [], fallback: true };

      const token = cfg.issueSourceToken;
      if (!token) return { tasks: [], fallback: true };

      const isNumericQuery = input.query !== undefined && /^\d+$/.test(input.query.trim());

      try {
        if (source === "github") {
          const url = new URL(tpl.replace("{id}", "0"));
          const parts = url.pathname.split("/").filter(Boolean);
          if (parts.length < 2) return { tasks: [], fallback: true };
          const [owner, repo] = parts;
          const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

          const apiUrl = input.query
            ? `https://api.github.com/search/issues?q=${encodeURIComponent(input.query)}+is:issue+is:open+repo:${owner}/${repo}&per_page=30`
            : `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=30`;

          const fetches: Promise<any>[] = [fetch(apiUrl, { headers })];
          if (isNumericQuery) fetches.push(fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${input.query}`, { headers }));

          const [listRes, byIdRes] = await Promise.all(fetches);
          if (!listRes.ok) return { tasks: [], fallback: true };
          const data = await listRes.json() as any;
          const items: any[] = input.query ? (data.items ?? []) : data;
          const seen = new Set<number>();
          const raw = items.map((i: any) => { seen.add(i.number); return { id: i.number as number, title: i.title as string, url: i.html_url as string, body: i.body as string | null }; });
          if (byIdRes?.ok) {
            const i = await byIdRes.json() as any;
            if (!seen.has(i.number)) raw.unshift({ id: i.number as number, title: i.title as string, url: i.html_url as string, body: i.body as string | null });
          }
          const blockedByMap = buildBlockedByMap(raw);
          return { tasks: raw.map(({ body: _, ...r }) => ({ ...r, blockedBy: blockedByMap.get(r.id) ?? [] })), fallback: false };
        } else {
          const url = new URL(tpl.replace("{id}", "0"));
          const apiBase = `${url.protocol}//${url.hostname}/api/v4`;
          const pathParts = url.pathname.split("/-/");
          if (pathParts.length < 2) return { tasks: [], fallback: true };
          const projectPath = encodeURIComponent(pathParts[0].replace(/^\//, ""));
          const headers = { "PRIVATE-TOKEN": token };

          const search = input.query ? `&search=${encodeURIComponent(input.query)}` : "";
          const fetches: Promise<any>[] = [fetch(`${apiBase}/projects/${projectPath}/issues?state=opened&per_page=30${search}`, { headers })];
          if (isNumericQuery) fetches.push(fetch(`${apiBase}/projects/${projectPath}/issues/${input.query}`, { headers }));

          const [listRes, byIdRes] = await Promise.all(fetches);
          if (!listRes.ok) return { tasks: [], fallback: true };
          const items = await listRes.json() as any[];
          const seen = new Set<number>();
          const raw = items.map((i: any) => { seen.add(i.iid); return { id: i.iid as number, title: i.title as string, url: i.web_url as string, body: i.description as string | null }; });
          if (byIdRes?.ok) {
            const i = await byIdRes.json() as any;
            if (!seen.has(i.iid)) raw.unshift({ id: i.iid as number, title: i.title as string, url: i.web_url as string, body: i.description as string | null });
          }
          const blockedByMap = buildBlockedByMap(raw);
          return { tasks: raw.map(({ body: _, ...r }) => ({ ...r, blockedBy: blockedByMap.get(r.id) ?? [] })), fallback: false };
        }
      } catch {
        return { tasks: [], fallback: true };
      }
    }),

  stepModuleData: publicProcedure
    .input(z.object({ id: z.string(), stepSlug: z.string(), module: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      const state = await getTaskWorkflowState(input.id);
      if (!state) return null;
      const snapshot = JSON.parse(state.workflow_snapshot);
      const step = snapshot.steps?.find((s: any) => s.slug === input.stepSlug);
      if (!step) return null;
      const row = (await db
        .select()
        .from(stepModuleData)
        .where(
          and(
            eq(stepModuleData.task_id, parseInt(input.id)),
            eq(stepModuleData.step_id, step.id),
            eq(stepModuleData.module, input.module),
          ),
        ))[0];
      return row ? JSON.parse(row.data) : null;
    }),

  updateStepModuleData: publicProcedure
    .input(z.object({ id: z.string(), stepSlug: z.string(), module: z.string(), data: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      const state = await getTaskWorkflowState(input.id);
      if (!state) throw new Error(`No workflow state for task ${input.id}`);
      const snapshot = JSON.parse(state.workflow_snapshot);
      const step = snapshot.steps?.find((s: any) => s.slug === input.stepSlug);
      if (!step) throw new Error(`Step ${input.stepSlug} not found`);
      const now = new Date().toISOString();
      const existing = (await db
        .select({ id: stepModuleData.id })
        .from(stepModuleData)
        .where(
          and(
            eq(stepModuleData.task_id, parseInt(input.id)),
            eq(stepModuleData.step_id, step.id),
            eq(stepModuleData.module, input.module),
          ),
        ))[0];
      if (existing) {
        await db.update(stepModuleData)
          .set({ data: input.data, updated_at: now })
          .where(eq(stepModuleData.id, existing.id));
      } else {
        await db.insert(stepModuleData).values({
          task_id: parseInt(input.id),
          step_id: step.id,
          module: input.module,
          data: input.data,
        });
      }
      return { ok: true };
    }),

  log: publicProcedure
    .input(
      z.object({
        id: z.string(),
        step: z.string().optional(),
        offset: z.number().optional(),
        networkOffset: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);

      const offset = input.offset ?? 0;
      let raw = "";
      let nextOffset = offset;

      const logStatus = await readStatus(input.id);
      const phase = input.step || logStatus?.step || "";

      if (!isAgentConnectedForUser(ctx.userId)) {
        return { entries: [], nextOffset: offset };
      }

      const cfg = logStatus?.project_id ? await getProjectConfig(logStatus.project_id, ctx.userId) : null;
      const projectRoot = cfg?.projectRoot ?? "";
      const networkPolicy = (logStatus as any)?.network_policy ?? cfg?.networkPolicy ?? "none";
      const mcpConfigPath = cfg?.mcpConfig ?? null;
      let networkEntries: any[] = [];
      let nextNetworkOffset = input.networkOffset ?? 0;
      try {
        const ack = await sendCommand("log_subscribe", { taskId: input.id, phase, offset, networkOffset: input.networkOffset ?? 0, projectRoot, networkPolicy, mcpConfigPath, orgId: ctx.orgId ? String(ctx.orgId) : undefined, projectId: cfg?.projectId || undefined }, 15000);
        const data = ack.data as { raw: string; nextOffset: number; networkEntries?: any[]; nextNetworkOffset?: number } | undefined;
        raw = data?.raw ?? "";
        nextOffset = data?.nextOffset ?? offset;
        networkEntries = data?.networkEntries ?? [];
        nextNetworkOffset = data?.nextNetworkOffset ?? nextNetworkOffset;
      } catch {
        return { entries: [], nextOffset: offset };
      }

      if (!raw.trim()) return { entries: [], nextOffset };

      const entries: any[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const entry = parseLogEntry(obj);
          if (entry) entries.push(entry);
        } catch {
          if (
            line.includes("can't remove") && line.includes("settings.json") ||
            line.includes("inter-device move failed") ||
            line.includes("unable to remove target: Device or resource busy") ||
            line.includes("UNDICI-EHPA") ||
            line.includes("Use `node --trace-warnings")
          ) continue;
          entries.push({ type: "raw", text: line });
        }
      }

      if (networkEntries.length > 0) entries.push(...networkEntries);

      return { entries: mergeToolOutputs(entries), nextOffset, nextNetworkOffset };
    }),

  changeReport: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      const taskRow = (await db.select({ task_id: tasks.task_id, project_id: tasks.project_id })
        .from(tasks).where(eq(tasks.task_id, parseInt(input.id))).limit(1))[0];
      if (!taskRow?.project_id) return null;
      const wfState = (await db.select({ snapshot: taskWorkflowStates.workflow_snapshot })
        .from(taskWorkflowStates).where(eq(taskWorkflowStates.task_id, taskRow.task_id)).limit(1))[0];
      if (!wfState) return null;
      const snapshot = JSON.parse(wfState.snapshot);
      for (const step of snapshot.steps ?? []) {
        const row = (await db.select({ data: stepModuleData.data })
          .from(stepModuleData)
          .where(and(eq(stepModuleData.task_id, taskRow.task_id), eq(stepModuleData.step_id, step.id), eq(stepModuleData.module, "change_report")))
          .limit(1))[0];
        if (row?.data?.trim()) return { diff: row.data };
      }
      return null;
    }),

  setProject: publicProcedure
    .input(z.object({ taskId: z.number().int(), projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectAccess(ctx.orgId, input.projectId);
      await patchStatus(String(input.taskId), { project_id: input.projectId });
      return { ok: true };
    }),
});
