import { z } from "zod";
import { router, protectedProcedure as publicProcedure } from "./init";
import {
  readStatus,
  writeStatus,
  patchStatus,
  deleteTask,
  getTaskWorkflowState,
  advanceWorkflowState,
  createTaskWorkflowState,
  markWorkflowStepComplete,
  upsertStepPrompt,
} from "../lib/status";
import { db } from "../db";
import { tasks, workflows, workflowSteps, workflowTransitions, projects, userProjectSettings } from "../db/schema";
import { eq, asc, max, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireTaskAccess, requireTaskDeleteAccess } from "../lib/auth-guard";

import { sendCommand, isAgentConnectedForUser } from "../ws/dispatch";
import { getProjectConfig } from "../lib/project-bootstrap";
import { getResourceMetrics } from "../lib/resources";
import { checkOpenBlockers } from "../lib/blockers";
import { log } from "../logger";

async function getTaskProjectId(taskId: string): Promise<string | null> {
  const status = await readStatus(taskId);
  return (status as any)?.project_id ?? null;
}

type PhaseSegment = { started_at: string; elapsed_ms: number | null };
type PhaseTimings = Record<string, { segments: PhaseSegment[] }>;

async function getPhaseTimings(taskId: string): Promise<PhaseTimings> {
  const status = await readStatus(taskId);
  try { return JSON.parse((status as any)?.phase_timings || "{}"); } catch { return {}; }
}

async function openSegment(taskId: string, phase: string, startedAt: string) {
  const timings = await getPhaseTimings(taskId);
  const segments = [...(timings[phase]?.segments ?? []), { started_at: startedAt, elapsed_ms: null }];
  await patchStatus(taskId, { phase_timings: JSON.stringify({ ...timings, [phase]: { segments } }) });
}

async function closeSegment(taskId: string, phase: string, elapsedMs: number) {
  const timings = await getPhaseTimings(taskId);
  const segments = (timings[phase]?.segments ?? []).map((s, i, arr) =>
    i === arr.length - 1 && s.elapsed_ms === null ? { ...s, elapsed_ms: elapsedMs } : s
  );
  await patchStatus(taskId, { phase_timings: JSON.stringify({ ...timings, [phase]: { segments } }) });
}

export const actionsRouter = router({
  init: publicProcedure
    .input(z.object({
      issues: z.array(z.number()).optional(),
      projectId: z.string().optional(),
      networkPolicy: z.enum(["none", "strict"]).optional(),
      llmProvider: z.string().optional(),
      llmModel: z.string().optional(),
      llmMaxTurns: z.number().int().positive().optional(),
      source_type: z.enum(["provider", "prompt"]).optional().default("provider"),
      prompt: z.string().optional(),
      branchResolution: z.array(z.object({
        id: z.number(),
        action: z.enum(["reuse", "new"]),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const baseCfg = await getProjectConfig(input.projectId ?? null, ctx.userId);
      const cfg = {
        ...baseCfg,
        ...(input.networkPolicy !== undefined && { networkPolicy: input.networkPolicy }),
        ...(input.llmProvider !== undefined && { llmProvider: input.llmProvider }),
        ...(input.llmModel !== undefined && { llmModel: input.llmModel }),
        ...(input.llmMaxTurns !== undefined && { llmMaxTurns: input.llmMaxTurns }),
      };

      // ── Prompt-sourced task ──────────────────────────────────────────────────
      if (input.source_type === "prompt") {
        if (!input.prompt?.trim()) throw new Error("prompt is required for source_type=prompt");

        // Derive task_id: MAX(task_id) + 1, or 1 if empty
        const [maxRow] = await db.select({ val: max(tasks.task_id) }).from(tasks);
        const taskId = (maxRow?.val ?? 0) + 1;

        // Derive title from first non-empty line, truncated
        const title = input.prompt.trim().split("\n").find((l) => l.trim()) ?? "Untitled task";
        const truncatedTitle = title.length > 120 ? title.slice(0, 117) + "…" : title;

        // Resolve workflow and first step slug
        let resolvedWorkflowId: number | undefined;
        let firstStepSlug = "";
        try {
          const { projects: projectsTable } = await import("../db/schema");
          const projectRow = input.projectId
            ? (await db.select({ workflow_id: projectsTable.workflow_id })
                .from(projectsTable)
                .where(eq(projectsTable.project_id, input.projectId)))[0]
            : null;
          resolvedWorkflowId = (projectRow as any)?.workflow_id
            ?? (await db.select({ id: workflows.id }).from(workflows))[0]?.id;
          if (resolvedWorkflowId) {
            const first = (await db.select({ slug: workflowSteps.slug })
              .from(workflowSteps)
              .where(eq(workflowSteps.workflow_id, resolvedWorkflowId))
              .orderBy(asc(workflowSteps.position)))[0];
            if (first) firstStepSlug = first.slug;
          }
        } catch { /* */ }

        const startTime = new Date().toISOString();

        await writeStatus(String(taskId), {
          task_id: taskId,
          project_id: input.projectId ?? null,
          step: firstStepSlug,
          status: "starting",
          source_type: "prompt",
          network_policy: input.networkPolicy ?? null,
          title: truncatedTitle,
          prompt: input.prompt,
          started_at: startTime,
          finished_at: null,
          pid: null,
          session_id: null,
          plan_summary: null,
          mr_url: null,
          error: null,
          phase_timings: JSON.stringify({ [firstStepSlug]: { started_at: startTime } }),
          created_by: ctx.userId,
        });

        await upsertStepPrompt(String(taskId), firstStepSlug, input.prompt);

        // Create workflow state
        try {
          if (resolvedWorkflowId) {
            const wfSteps = await db.select().from(workflowSteps)
              .where(eq(workflowSteps.workflow_id, resolvedWorkflowId))
              .orderBy(asc(workflowSteps.position));
            const allTransitions = await db.select().from(workflowTransitions);
            const wfTransitions = allTransitions.filter((t) => wfSteps.some((s) => s.id === t.from_step_id));
            const wfRow = (await db.select().from(workflows).where(eq(workflows.id, resolvedWorkflowId)))[0];

            const snapshot = {
              id: resolvedWorkflowId,
              name: wfRow?.name ?? "Default",
              steps: wfSteps.map((s) => ({
                id: s.id, slug: s.slug, name: s.name, position: s.position,
                toolPreset: s.tool_preset, toolAllowlist: s.tool_allowlist ? JSON.parse(s.tool_allowlist) : null,
                containerMode: s.container_mode, modules: JSON.parse(s.modules),
                networkPolicy: s.network_policy, autoAdvance: !!s.auto_advance,
                promptTemplate: s.prompt_template,
              })),
              transitions: wfTransitions.map((t) => ({
                id: t.id, fromStepId: t.from_step_id, toStepId: t.to_step_id,
                label: t.label, condition: t.condition, isDefault: !!t.is_default, position: t.position,
              })),
            };

            const firstStep = wfSteps[0] ?? null;
            const history = firstStep
              ? [{ stepId: firstStep.id, slug: firstStep.slug, startedAt: startTime, finishedAt: null, status: "running" }]
              : [];

            await createTaskWorkflowState(String(taskId), resolvedWorkflowId, firstStep?.id ?? null, snapshot);
            const { taskWorkflowStates: iws } = await import("../db/schema");
            await db.update(iws)
              .set({ step_history: JSON.stringify(history) })
              .where(eq(iws.task_id, taskId));
          }
        } catch (e: any) {
          log.warn(`Failed to create workflow state for task #${taskId}: ${e.message}`);
        }

        log.info(`Dispatching prompt task #${taskId} to agent`);
        await sendCommand("init", {
          issues: [taskId],
          projectId: input.projectId ?? null,
          sourceType: "prompt",
          ...(input.networkPolicy !== undefined && { networkPolicy: input.networkPolicy }),
          ...(input.llmProvider !== undefined && { llmProvider: input.llmProvider }),
          ...(input.llmModel !== undefined && { llmModel: input.llmModel }),
          ...(input.llmMaxTurns !== undefined && { llmMaxTurns: input.llmMaxTurns }),
        }, 60000);
        return { ok: true, initialized: [taskId], skipped: [] };
      }

      // ── Provider-sourced tasks ───────────────────────────────────────────────
      const ids = input.issues ?? [];
      if (ids.length === 0) throw new Error("issues is required for source_type=provider");

      const { metrics } = await getResourceMetrics();
      if (metrics?.capacity && metrics.capacity.estimated_remaining < ids.length) {
        log.warn(
          `Capacity warning: ~${metrics.capacity.estimated_remaining} containers estimated (avg peak ${metrics.capacity.avg_peak_mb} MB), ${ids.length} requested`,
        );
      }

      log.info(`Init requested for tasks: ${ids.join(", ")}${input.projectId ? ` (project: ${input.projectId})` : ""}`);
      const initialized: number[] = [];
      const skipped: { id: number; reason: string }[] = [];
      const conflicts: { id: number; branch: string }[] = [];
      const branchOverrides: Record<string, string> = {};
      const resolutionMap = new Map((input.branchResolution ?? []).map((r) => [r.id, r.action]));

      for (const id of ids) {
        const worktree = `${cfg.worktreePrefix}${id}`;
        const rawStatus = await readStatus(String(id));
        const existingStatus = (rawStatus?.project_id === (input.projectId ?? null)) ? rawStatus : null;

        const openBlockers = await checkOpenBlockers(cfg, id);
        if (openBlockers.length > 0) {
          log.warn(`Task #${id}: skipped — blocked by #${openBlockers.join(", #")}`);
          skipped.push({ id, reason: `Blocked by #${openBlockers.join(", #")}` });
          continue;
        }

        const checkAck = await sendCommand("checkIssue", {
          worktree,
          projectRoot: cfg.projectRoot,
          branch: `${cfg.branchPrefix}${id}`,
        });
        const { worktreeExists, branchExists } = checkAck.data as { worktreeExists: boolean; branchExists: boolean };

        if (worktreeExists) {
          log.info(`Task #${id}: worktree found, requesting cleanup before re-init`);
          try {
            await sendCommand("cleanup", { taskId: String(id), projectId: input.projectId ?? null });
            const recheckAck = await sendCommand("checkIssue", { worktree, projectRoot: cfg.projectRoot, branch: `${cfg.branchPrefix}${id}` });
            if ((recheckAck.data as any).worktreeExists) {
              log.warn(`Task #${id}: cleanup acked but worktree still exists`);
              skipped.push({ id, reason: "Cleanup finished but worktree still exists" });
              continue;
            }
            log.success(`Task #${id}: worktree cleaned up`);
          } catch (err: any) {
            log.error(`Task #${id}: cleanup failed — ${err.message}`);
            skipped.push({ id, reason: "Failed to clean up worktree" });
            continue;
          }
        }

        if (branchExists && existingStatus) {
          const resolution = resolutionMap.get(id);
          if (!resolution) {
            conflicts.push({ id, branch: `${cfg.branchPrefix}${id}` });
            continue;
          }
          if (resolution === "new") {
            let suffix = 2;
            while (true) {
              const newBranch = `${cfg.branchPrefix}${id}-${suffix}`;
              const check = await sendCommand("checkIssue", {
                worktree, projectRoot: cfg.projectRoot, branch: newBranch,
              });
              if (!(check.data as any).branchExists) {
                branchOverrides[String(id)] = newBranch;
                break;
              }
              suffix++;
            }
          }
          // resolution === "reuse": proceed with existing branch (createWorktree handles it)
        }

        const startTime = new Date().toISOString();

        // Resolve workflow for this task
        let resolvedWorkflowId: number | undefined;
        let firstStepSlug = "";
        try {
          const { projects: projectsTable } = await import("../db/schema");
          const projectRow = input.projectId
            ? (await db.select({ workflow_id: projectsTable.workflow_id })
                .from(projectsTable)
                .where(eq(projectsTable.project_id, input.projectId)))[0]
            : null;
          resolvedWorkflowId = (projectRow as any)?.workflow_id
            ?? (await db.select({ id: workflows.id }).from(workflows))[0]?.id;
          if (resolvedWorkflowId) {
            const first = (await db.select({ slug: workflowSteps.slug })
              .from(workflowSteps)
              .where(eq(workflowSteps.workflow_id, resolvedWorkflowId))
              .orderBy(asc(workflowSteps.position)))[0];
            if (first) firstStepSlug = first.slug;
          }
        } catch { /* */ }

        await writeStatus(String(id), {
          task_id: id,
          project_id: input.projectId ?? null,
          step: firstStepSlug,
          status: "starting",
          source_type: "provider",
          network_policy: input.networkPolicy ?? null,
          started_at: startTime,
          finished_at: null,
          pid: null,
          session_id: null,
          plan_summary: null,
          mr_url: null,
          error: null,
          phase_timings: JSON.stringify({ [firstStepSlug]: { segments: [{ started_at: startTime, elapsed_ms: null }] } }),
          created_by: ctx.userId,
        });

        try {
          const workflowId = resolvedWorkflowId;

          if (workflowId) {
            const wfSteps = await db.select().from(workflowSteps)
              .where(eq(workflowSteps.workflow_id, workflowId))
              .orderBy(asc(workflowSteps.position));
            const allTransitions = await db.select().from(workflowTransitions);
            const wfTransitions = allTransitions.filter((t) => wfSteps.some((s) => s.id === t.from_step_id));
            const wfRow = (await db.select().from(workflows).where(eq(workflows.id, workflowId)))[0];

            const snapshot = {
              id: workflowId,
              name: wfRow?.name ?? "Default",
              steps: wfSteps.map((s) => ({
                id: s.id, slug: s.slug, name: s.name, position: s.position,
                toolPreset: s.tool_preset, toolAllowlist: s.tool_allowlist ? JSON.parse(s.tool_allowlist) : null,
                containerMode: s.container_mode, modules: JSON.parse(s.modules),
                networkPolicy: s.network_policy, autoAdvance: !!s.auto_advance,
                promptTemplate: s.prompt_template,
              })),
              transitions: wfTransitions.map((t) => ({
                id: t.id, fromStepId: t.from_step_id, toStepId: t.to_step_id,
                label: t.label, condition: t.condition, isDefault: !!t.is_default, position: t.position,
              })),
            };

            const firstStep = wfSteps[0] ?? null;
            const history = firstStep
              ? [{ stepId: firstStep.id, slug: firstStep.slug, startedAt: startTime, finishedAt: null, status: "running" }]
              : [];

            await createTaskWorkflowState(String(id), workflowId, firstStep?.id ?? null, snapshot);
            const { taskWorkflowStates: iws } = await import("../db/schema");
            await db.update(iws)
              .set({ step_history: JSON.stringify(history) })
              .where(eq(iws.task_id, id));
          }
        } catch (e: any) {
          log.warn(`Failed to create workflow state for task #${id}: ${e.message}`);
        }

        initialized.push(id);
      }

      if (initialized.length > 0) {
        log.info(`Dispatching init to agent for: ${initialized.join(", ")}`);
        await sendCommand("init", {
          issues: initialized,
          projectId: input.projectId ?? null,
          sourceType: "provider",
          ...(Object.keys(branchOverrides).length > 0 && { branchOverrides }),
          ...(input.networkPolicy !== undefined && { networkPolicy: input.networkPolicy }),
          ...(input.llmProvider !== undefined && { llmProvider: input.llmProvider }),
          ...(input.llmModel !== undefined && { llmModel: input.llmModel }),
          ...(input.llmMaxTurns !== undefined && { llmMaxTurns: input.llmMaxTurns }),
        }, 60000);
      }

      if (skipped.length > 0) {
        log.warn(`Skipped: ${skipped.map((s) => `#${s.id} (${s.reason})`).join(", ")}`);
      }

      if (conflicts.length > 0) {
        log.warn(`Branch conflicts: ${conflicts.map((c) => `#${c.id} (${c.branch})`).join(", ")}`);
      }

      return { ok: true, initialized, skipped, conflicts };
    }),

  execute: publicProcedure
    .input(z.object({ id: z.string(), prompt: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");
      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);
      const wfState = await getTaskWorkflowState(input.id);
      if (!wfState) throw new Error(`Task ${input.id} has no workflow state`);
      const snapshot = JSON.parse(wfState.workflow_snapshot);
      const transition = snapshot.transitions.find((t: any) => t.fromStepId === wfState.current_step_id && t.isDefault);
      if (!transition) throw new Error(`No default transition from current step`);
      const nextStep = snapshot.steps.find((s: any) => s.id === transition.toStepId);
      if (!nextStep) throw new Error(`Next step not found`);
      const projectId = await getTaskProjectId(input.id);
      const now = new Date().toISOString();
      await advanceWorkflowState(input.id, transition.id, nextStep.slug, now);
      await openSegment(input.id, nextStep.slug, now);
      await patchStatus(input.id, { step: nextStep.slug, status: "running" });
      await sendCommand("advance", { taskId: input.id, stepSlug: nextStep.slug, transitionId: transition.id, projectId, sourceType: (status as any).source_type });
      return { ok: true, message: "Execution launched" };
    }),

  advance: publicProcedure
    .input(z.object({
      id: z.string(),
      transitionId: z.number(),
      stepSlug: z.string(),
      prompt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);

      const projectId = await getTaskProjectId(input.id);
      log.info(`Task #${input.id}: advancing to step "${input.stepSlug}"`);

      const now = new Date().toISOString();
      await advanceWorkflowState(input.id, input.transitionId, input.stepSlug, now);

      await openSegment(input.id, input.stepSlug, now);
      await patchStatus(input.id, { step: input.stepSlug, status: "running" });

      await sendCommand("advance", {
        taskId: input.id,
        stepSlug: input.stepSlug,
        transitionId: input.transitionId,
        projectId,
        sourceType: (status as any).source_type,
      });

      return { ok: true, message: `Advanced to "${input.stepSlug}"` };
    }),

  continue: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);
      if (status.status !== "failed" && status.status !== "stopped") {
        throw new Error(
          `Task ${input.id} status is "${status.status}", expected "failed" or "stopped"`,
        );
      }
      if (status.status === "failed" && (status as any).failure_reason !== "max_turns") {
        throw new Error(
          `Continue is only available for max_turns failures. Use relaunch instead.`,
        );
      }
      if (!status.session_id) {
        throw new Error(`Task ${input.id} has no session_id to resume`);
      }

      const projectId = await getTaskProjectId(input.id);
      log.info(`Task #${input.id}: continuing ${status.step} (session: ${status.session_id})`);
      await patchStatus(input.id, { status: "running", error: null, failure_reason: null } as any);
      await openSegment(input.id, status.step, new Date().toISOString());
      await sendCommand("continue", {
        taskId: input.id,
        phase: status.step,
        projectId,
        sourceType: (status as any).source_type,
      });

      return { ok: true, message: "Continue launched" };
    }),

  refine: publicProcedure
    .input(z.object({ id: z.string(), prompt: z.string().min(1), phase: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);
      if (status.status === "running" || status.status === "starting") {
        throw new Error(`Task ${input.id} is currently ${status.status}`);
      }
      if (!status.session_id) {
        throw new Error(`Task ${input.id} has no session_id to resume`);
      }

      const targetPhase = input.phase ?? status.step;
      const projectId = await getTaskProjectId(input.id);
      log.info(`Task #${input.id}: refining ${targetPhase} (session: ${status.session_id})`);
      await patchStatus(input.id, { status: "running", error: null, failure_reason: null } as any);
      await openSegment(input.id, targetPhase, new Date().toISOString());
      await sendCommand("refine", {
        taskId: input.id,
        phase: targetPhase,
        prompt: input.prompt,
        projectId,
        sourceType: (status as any).source_type,
      });

      return { ok: true, message: "Refine launched" };
    }),

  relaunch: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);
      if (status.status !== "failed" && status.status !== "stopped") {
        throw new Error(
          `Task ${input.id} status is "${status.status}", expected "failed" or "stopped"`,
        );
      }

      const projectId = await getTaskProjectId(input.id);
      log.info(`Task #${input.id}: relaunching ${status.step}`);
      await patchStatus(input.id, {
        status: "running",
        error: null,
        session_id: null,
        failure_reason: null,
      } as any);
      await openSegment(input.id, status.step, new Date().toISOString());
      await sendCommand("relaunch", {
        taskId: input.id,
        phase: status.step,
        projectId,
        sourceType: (status as any).source_type,
      });

      return { ok: true, message: "Relaunch started" };
    }),

  stop: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);
      if (status.status !== "running" && status.status !== "starting") {
        throw new Error(`Task ${input.id} is not running`);
      }

      const projectId = await getTaskProjectId(input.id);
      log.info(`Task #${input.id}: stopping ${status.step}`);
      const ack = await sendCommand("stop", {
        taskId: input.id,
        pid: status.pid,
        phase: status.step,
        projectId,
      });

      const sessionId =
        (ack.data as any)?.sessionId ?? status.session_id;
      const stopTime = new Date();
      const timings = await getPhaseTimings(input.id);
      const segments = timings[status.step]?.segments ?? [];
      const lastOpen = [...segments].reverse().find((s) => s.elapsed_ms === null);
      const elapsedMs = lastOpen ? stopTime.getTime() - new Date(lastOpen.started_at).getTime() : 0;
      await closeSegment(input.id, status.step, elapsedMs);
      await patchStatus(input.id, {
        status: "stopped",
        pid: null,
        session_id: sessionId,
        error: "Stopped by user",
        finished_at: stopTime.toISOString(),
      });

      return { ok: true, message: "Session stopped" };
    }),

  resolve: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);
      if (status.status !== "stopped") {
        throw new Error(
          `Task ${input.id} status is "${status.status}", expected "stopped"`,
        );
      }

      const wfState = await getTaskWorkflowState(input.id);
      if (!wfState) throw new Error(`Task ${input.id} has no workflow state`);

      await patchStatus(input.id, { status: "step_done", error: null });

      return { ok: true, message: "Marked as step_done" };
    }),

  cleanup: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);

      const projectId = await getTaskProjectId(input.id);
      await sendCommand("cleanup", {
        taskId: input.id,
        pid: status.pid,
        projectId,
      });

      await patchStatus(input.id, {
        status: "cleaned_up",
        step: "cleanup",
        finished_at: new Date().toISOString(),
        pid: null,
      });

      return { ok: true, message: "Cleaned up" };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskDeleteAccess(ctx.orgId, ctx.userId, input.id);
      if (isAgentConnectedForUser(ctx.userId)) {
        const projectId = await getTaskProjectId(input.id);
        try {
          await sendCommand("stop", { taskId: input.id, projectId }).catch(() => {});
          await sendCommand("cleanup", { taskId: input.id, projectId, orgId: ctx.orgId ? String(ctx.orgId) : undefined });
        } catch {
          // Best-effort — still delete DB rows
        }
      }

      await deleteTask(input.id);
      log.info(`Task #${input.id}: deleted`);
      return { ok: true, message: "Task deleted" };
    }),

  devServers: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);

      const projectId = await getTaskProjectId(input.id);
      const ack = await sendCommand("devServers", {
        taskId: input.id,
        action: "start",
        projectId,
      });

      const ackData = ack.data as
        | { launched: { name: string; port: number }[] }
        | undefined;
      return {
        ok: true,
        launched: ackData?.launched ?? [],
      };
    }),

  devServersStatus: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) {
        return { running: false, servers: [] };
      }

      const projectId = await getTaskProjectId(input.id);
      const ack = await sendCommand("devServers", {
        taskId: input.id,
        action: "status",
        projectId,
      });

      return (ack.data as any) ?? { running: false, servers: [] };
    }),

  devServersStop: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const projectId = await getTaskProjectId(input.id);
      await sendCommand("devServers", {
        taskId: input.id,
        action: "stop",
        projectId,
      });

      return { ok: true, message: "Dev servers stopped" };
    }),

  openTerminal: publicProcedure
    .input(z.object({ id: z.string(), phase: z.string().optional(), terminalId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await requireTaskAccess(ctx.orgId, input.id);
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const status = await readStatus(input.id);
      if (!status) throw new Error(`Task ${input.id} not found`);

      const projectId = await getTaskProjectId(input.id);
      const ack = await sendCommand("openTerminal", {
        taskId: input.id,
        phase: input.phase || status.step,
        sessionId: status.session_id,
        projectId,
        terminalId: input.terminalId,
      });

      const data = ack.data as any;
      return {
        ok: true,
        message: "Sandbox shell opened",
        session_id: data?.session_id || null,
      };
    }),

  detect: publicProcedure
    .input(z.object({
      projectRoot: z.string().min(1),
      prompt: z.string().min(1),
      llmMaxTurns: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!isAgentConnectedForUser(ctx.userId)) throw new Error("Agent not connected");

      const [maxRow] = await db.select({ val: max(tasks.task_id) }).from(tasks);
      const taskId = (maxRow?.val ?? 0) + 1;
      const startTime = new Date().toISOString();

      await writeStatus(String(taskId), {
        task_id: taskId,
        project_id: null,
        source_type: "detect",
        step: "detect",
        status: "starting",
        title: "Project detection",
        prompt: input.prompt,
        started_at: startTime,
        finished_at: null,
        pid: null,
        session_id: null,
        plan_summary: null,
        mr_url: null,
        error: null,
        phase_timings: JSON.stringify({ detect: { started_at: startTime } }),
        created_by: ctx.userId,
      });

      await upsertStepPrompt(String(taskId), "detect", input.prompt);

      log.info(`Dispatching detect task #${taskId} for ${input.projectRoot}`);
      await sendCommand("init", {
        issues: [taskId],
        projectId: null,
        sourceType: "detect",
        projectRoot: input.projectRoot,
        worktreePrefix: `${input.projectRoot}/.ysa/worktrees/`,
        llmMaxTurns: input.llmMaxTurns ?? 30,
      }, 60000);
      return { taskId };
    }),

  setupSandbox: publicProcedure
    .input(z.object({
      directory: z.string().min(1),
      llmProvider: z.string().default("claude"),
    }))
    .mutation(async ({ input, ctx }) => {
      const dir = input.directory.replace(/\/+$/, "");
      const existing = await db.select({ project_id: projects.project_id })
        .from(projects)
        .innerJoin(userProjectSettings, eq(userProjectSettings.project_id, projects.project_id))
        .where(eq(projects.org_id, ctx.orgId))
        .then((rows) => rows.find((r) => /^sandbox-[0-9a-f]{6}$/.test(r.project_id)));
      const builtinWorkflow = (await db.select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.is_builtin, true), eq(workflows.name, "Plan & Execute")))
        .limit(1))[0];
      if (existing) {
        await db.update(userProjectSettings)
          .set({ project_root: dir, worktree_prefix: `${dir}/.ysa/worktrees` })
          .where(eq(userProjectSettings.project_id, existing.project_id));
        if (builtinWorkflow) {
          await db.update(projects)
            .set({ workflow_id: builtinWorkflow.id })
            .where(eq(projects.project_id, existing.project_id));
        }
        const { pushSyncConfig } = await import("../ws/handler");
        pushSyncConfig([existing.project_id]).catch(() => {});
        return { projectId: existing.project_id };
      }
      const suffix = randomBytes(3).toString("hex");
      const projectId = `sandbox-${suffix}`;
      await db.insert(projects).values({
        project_id: projectId,
        name: "Sandbox",
        branch_prefix: "sandbox/",
        default_branch: "main",
        issue_url_template: "",
        issue_source: "prompt",
        network_policy: "strict",
        llm_provider: input.llmProvider,
        org_id: ctx.orgId,
        ...(builtinWorkflow ? { workflow_id: builtinWorkflow.id } : {}),
      });
      await db.insert(userProjectSettings).values({
        user_id: ctx.userId,
        project_id: projectId,
        project_root: dir,
        worktree_prefix: `${dir}/.ysa/worktrees`,
      });
      const { pushSyncConfig } = await import("../ws/handler");
      pushSyncConfig([projectId]).catch(() => {});
      return { projectId };
    }),
});
