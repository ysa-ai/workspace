import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure as publicProcedure } from "./init";
import { db } from "../db";
import { workflows, workflowSteps, workflowTransitions, toolPresets } from "../db/schema";
import { eq, asc, or, isNull } from "drizzle-orm";
import { requireWorkflowAccess, requireAdminRole } from "../lib/auth-guard";

const stepInput = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  position: z.number().int().min(0),
  promptTemplate: z.string().default(""),
  toolPreset: z.string().default("readonly"),
  toolAllowlist: z.array(z.string()).nullable().default(null),
  containerMode: z.enum(["readonly", "readwrite"]).default("readonly"),
  modules: z.array(z.object({ name: z.string(), prompt: z.string(), config: z.record(z.string(), z.unknown()).optional() })).default([]),
  networkPolicy: z.enum(["none", "strict"]).nullable().default(null),
  autoAdvance: z.boolean().default(false),
});

const transitionInput = z.object({
  fromStepIndex: z.number().int().min(0),
  toStepIndex: z.number().int().min(0).nullable(),
  label: z.string().nullable().default(null),
  condition: z.string().nullable().default(null),
  isDefault: z.boolean().default(false),
  position: z.number().int().default(0),
});

export async function getWorkflowWithSteps(workflowId: number) {
  const wf = (await db.select().from(workflows).where(eq(workflows.id, workflowId)))[0];
  if (!wf) return null;
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflow_id, workflowId))
    .orderBy(asc(workflowSteps.position));
  const allTransitions = await db.select().from(workflowTransitions);
  const transitions = allTransitions.filter((t) => steps.some((s) => s.id === t.from_step_id));
  return {
    ...wf,
    steps: steps.map((s) => ({
      ...s,
      modules: (() => { try { return JSON.parse(s.modules); } catch { return []; } })(),
      toolAllowlist: s.tool_allowlist ? (() => { try { return JSON.parse(s.tool_allowlist!); } catch { return null; } })() : null,
    })),
    transitions,
  };
}

export const toolPresetsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return db.select().from(toolPresets)
      .where(or(eq(toolPresets.is_builtin, true), eq(toolPresets.org_id, ctx.orgId)))
      .orderBy(asc(toolPresets.is_builtin), asc(toolPresets.name));
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().nullable().optional(),
      tools: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      return (await db.insert(toolPresets)
        .values({ name: input.name, description: input.description ?? null, tools: input.tools, is_builtin: false, org_id: ctx.orgId })
        .returning())[0]!;
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      tools: z.string().min(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = (await db.select().from(toolPresets).where(eq(toolPresets.id, input.id)))[0];
      if (!existing) throw new Error(`Preset ${input.id} not found`);
      if (existing.is_builtin) throw new Error("Cannot edit a built-in preset");
      if (existing.org_id !== ctx.orgId) throw new Error(`Preset ${input.id} not found`);
      return (await db.update(toolPresets)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.tools !== undefined && { tools: input.tools }),
          updated_at: new Date().toISOString(),
        })
        .where(eq(toolPresets.id, input.id))
        .returning())[0]!;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const existing = (await db.select().from(toolPresets).where(eq(toolPresets.id, input.id)))[0];
      if (!existing) throw new Error(`Preset ${input.id} not found`);
      if (existing.is_builtin) throw new Error("Cannot delete a built-in preset");
      if (existing.org_id !== ctx.orgId) throw new Error(`Preset ${input.id} not found`);
      await requireAdminRole(ctx.orgId, ctx.userId);
      await db.delete(toolPresets).where(eq(toolPresets.id, input.id));
      return { ok: true };
    }),
});

export const workflowsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return db.select().from(workflows)
      .where(or(eq(workflows.org_id, ctx.orgId), eq(workflows.is_builtin, true)))
      .orderBy(asc(workflows.name));
  }),

  get: publicProcedure
    .input(z.object({ workflowId: z.number() }))
    .query(async ({ input, ctx }) => {
      await requireWorkflowAccess(ctx.orgId, input.workflowId);
      const wf = await getWorkflowWithSteps(input.workflowId);
      if (!wf) throw new Error(`Workflow ${input.workflowId} not found`);
      return wf;
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().nullable().optional(),
      steps: z.array(stepInput),
      transitions: z.array(transitionInput),
    }))
    .mutation(async ({ input, ctx }) => {
      const now = new Date().toISOString();
      const wfId = (await db.insert(workflows)
        .values({ name: input.name, description: input.description ?? null, org_id: ctx.orgId })
        .returning({ id: workflows.id }))[0]!.id;

      const insertedStepIds: number[] = [];
      for (const step of input.steps) {
        const stepId = (await db.insert(workflowSteps).values({
          workflow_id: wfId,
          name: step.name,
          slug: step.slug,
          position: step.position,
          prompt_template: step.promptTemplate,
          tool_preset: step.toolPreset,
          tool_allowlist: step.toolAllowlist ? JSON.stringify(step.toolAllowlist) : null,
          container_mode: step.containerMode,
          modules: JSON.stringify(step.modules),
          network_policy: step.networkPolicy,
          auto_advance: step.autoAdvance,
        }).returning({ id: workflowSteps.id }))[0]!.id;
        insertedStepIds.push(stepId);
      }

      for (const t of input.transitions) {
        const fromStepId = insertedStepIds[t.fromStepIndex];
        const toStepId = t.toStepIndex !== null ? insertedStepIds[t.toStepIndex] : null;
        if (!fromStepId) continue;
        await db.insert(workflowTransitions).values({
          from_step_id: fromStepId,
          to_step_id: toStepId ?? null,
          label: t.label,
          condition: t.condition,
          is_default: t.isDefault,
          position: t.position,
        });
      }

      return (await getWorkflowWithSteps(wfId))!;
    }),

  update: publicProcedure
    .input(z.object({
      workflowId: z.number(),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      steps: z.array(stepInput).optional(),
      transitions: z.array(transitionInput).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { isBuiltin } = await requireWorkflowAccess(ctx.orgId, input.workflowId);
      const existing = (await db.select().from(workflows).where(eq(workflows.id, input.workflowId)))[0];
      if (!existing) throw new Error(`Workflow ${input.workflowId} not found`);

      let targetId = input.workflowId;
      if (isBuiltin) {
        targetId = (await db.insert(workflows)
          .values({
            name: input.name ?? existing.name,
            description: input.description !== undefined ? input.description : existing.description,
            org_id: ctx.orgId,
          })
          .returning({ id: workflows.id }))[0]!.id;
        if (targetId === input.workflowId) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot modify a built-in workflow" });
      }

      if (!isBuiltin && (input.name !== undefined || input.description !== undefined)) {
        await db.update(workflows)
          .set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            updated_at: new Date().toISOString(),
          })
          .where(eq(workflows.id, targetId));
      }

      if (input.steps !== undefined) {
        const existingSteps = await db
          .select()
          .from(workflowSteps)
          .where(eq(workflowSteps.workflow_id, targetId));
        const existingBySlug = new Map(existingSteps.map((s) => [s.slug, s]));
        const incomingSlugs = new Set(input.steps.map((s) => s.slug));

        // Delete transitions for steps that will be removed or replaced
        for (const s of existingSteps) {
          await db.delete(workflowTransitions).where(eq(workflowTransitions.from_step_id, s.id));
        }
        // Delete steps not in the incoming list
        for (const s of existingSteps) {
          if (!incomingSlugs.has(s.slug)) {
            await db.delete(workflowSteps).where(eq(workflowSteps.id, s.id));
          }
        }

        const insertedStepIds: number[] = [];
        for (const step of input.steps) {
          const vals = {
            workflow_id: targetId,
            name: step.name,
            slug: step.slug,
            position: step.position,
            prompt_template: step.promptTemplate,
            tool_preset: step.toolPreset,
            tool_allowlist: step.toolAllowlist ? JSON.stringify(step.toolAllowlist) : null,
            container_mode: step.containerMode,
            modules: JSON.stringify(step.modules),
            network_policy: step.networkPolicy,
            auto_advance: step.autoAdvance,
          };
          const existingStep = existingBySlug.get(step.slug);
          let stepId: number;
          if (existingStep) {
            await db.update(workflowSteps).set({ ...vals, updated_at: new Date().toISOString() }).where(eq(workflowSteps.id, existingStep.id));
            stepId = existingStep.id;
          } else {
            stepId = (await db.insert(workflowSteps).values(vals).returning({ id: workflowSteps.id }))[0]!.id;
          }
          insertedStepIds.push(stepId);
        }

        const transitions = input.transitions ?? [];
        for (const t of transitions) {
          const fromStepId = insertedStepIds[t.fromStepIndex];
          const toStepId = t.toStepIndex !== null ? insertedStepIds[t.toStepIndex] : null;
          if (!fromStepId) continue;
          await db.insert(workflowTransitions).values({
            from_step_id: fromStepId,
            to_step_id: toStepId ?? null,
            label: t.label,
            condition: t.condition,
            is_default: t.isDefault,
            position: t.position,
          });
        }
      }

      return (await getWorkflowWithSteps(targetId))!;
    }),

  delete: publicProcedure
    .input(z.object({ workflowId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const { isBuiltin } = await requireWorkflowAccess(ctx.orgId, input.workflowId);
      if (isBuiltin) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete a built-in workflow" });
      await requireAdminRole(ctx.orgId, ctx.userId);
      const existing = (await db.select().from(workflows).where(eq(workflows.id, input.workflowId)))[0];
      if (!existing) throw new Error(`Workflow ${input.workflowId} not found`);

      const stepIds = (await db
        .select({ id: workflowSteps.id })
        .from(workflowSteps)
        .where(eq(workflowSteps.workflow_id, input.workflowId)))
        .map((s) => s.id);

      for (const stepId of stepIds) {
        await db.delete(workflowTransitions).where(eq(workflowTransitions.from_step_id, stepId));
      }
      await db.delete(workflowSteps).where(eq(workflowSteps.workflow_id, input.workflowId));
      await db.delete(workflows).where(eq(workflows.id, input.workflowId));

      return { ok: true };
    }),

  duplicate: publicProcedure
    .input(z.object({ workflowId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await requireWorkflowAccess(ctx.orgId, input.workflowId); // builtins are duplicatable
      const source = await getWorkflowWithSteps(input.workflowId);
      if (!source) throw new Error(`Workflow ${input.workflowId} not found`);

      const newWfId = (await db.insert(workflows)
        .values({
          name: `${source.name} (copy)`,
          description: source.description,
          org_id: ctx.orgId,
        })
        .returning({ id: workflows.id }))[0]!.id;

      const stepIdMap = new Map<number, number>();
      for (const step of source.steps) {
        const newStepId = (await db.insert(workflowSteps).values({
          workflow_id: newWfId,
          name: step.name,
          slug: step.slug,
          position: step.position,
          prompt_template: step.prompt_template,
          tool_preset: step.tool_preset,
          tool_allowlist: step.tool_allowlist ? JSON.stringify(step.tool_allowlist) : null,
          container_mode: step.container_mode,
          modules: JSON.stringify(step.modules),
          network_policy: step.network_policy,
          auto_advance: step.auto_advance,
        }).returning({ id: workflowSteps.id }))[0]!.id;
        stepIdMap.set(step.id, newStepId);
      }

      for (const t of source.transitions) {
        const newFromId = stepIdMap.get(t.from_step_id);
        const newToId = t.to_step_id ? stepIdMap.get(t.to_step_id) ?? null : null;
        if (!newFromId) continue;
        await db.insert(workflowTransitions).values({
          from_step_id: newFromId,
          to_step_id: newToId,
          label: t.label,
          condition: t.condition,
          is_default: t.is_default,
          position: t.position,
        });
      }

      return (await getWorkflowWithSteps(newWfId))!;
    }),
});
