import { readStatus, readStuckTasks, getTaskWorkflowState, upsertStepPrompt } from "../lib/status";
import { getProjectConfig } from "../lib/project-bootstrap";
import { db } from "../db";
import { tasks, stepResults, stepModuleData, toolPresets } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getAgentUserId } from "./handler";

type Respond = (ok: boolean, data?: unknown, error?: string) => void;

export async function handleAgentRequest(command: string, payload: Record<string, unknown>, respond: Respond): Promise<void> {
  switch (command) {
    case "get_workflow": {
      const taskId = String(payload.taskId);
      const state = await getTaskWorkflowState(taskId);
      if (!state) { respond(false, undefined, `No workflow state for task ${taskId}`); return; }
      try {
        const snapshot = JSON.parse(state.workflow_snapshot);
        const stepId = state.current_step_id;
        const builtinPresets = new Set(["readonly", "readwrite", "post-execution", "custom"]);
        const steps = await Promise.all((snapshot.steps ?? []).map(async (s: any) => {
          if (!builtinPresets.has(s.toolPreset) && !s.toolAllowlist) {
            const preset = (await db.select().from(toolPresets).where(eq(toolPresets.name, s.toolPreset)))[0];
            if (preset) return { ...s, toolAllowlist: preset.tools.split(",").map((t: string) => t.trim()) };
          }
          return s;
        }));
        respond(true, {
          workflowId: state.workflow_id,
          currentStepId: stepId,
          currentStep: stepId ? steps.find((s: any) => s.id === stepId) ?? null : null,
          steps,
          transitions: snapshot.transitions ?? [],
          stepHistory: (() => { try { return JSON.parse(state.step_history); } catch { return []; } })(),
        });
      } catch { respond(false, undefined, "Invalid workflow snapshot"); }
      break;
    }

    case "get_step_result": {
      const { taskId, stepSlug } = payload as { taskId: string; stepSlug: string };
      const state = await getTaskWorkflowState(String(taskId));
      if (!state) { respond(true, null); return; }
      try {
        const snapshot = JSON.parse(state.workflow_snapshot);
        const step = snapshot.steps?.find((s: any) => s.slug === stepSlug);
        if (!step) { respond(true, null); return; }
        const row = (await db.select().from(stepResults)
          .where(and(eq(stepResults.task_id, Number(taskId)), eq(stepResults.step_id, step.id))))[0];
        respond(true, row?.content ?? null);
      } catch { respond(true, null); }
      break;
    }

    case "get_module_data": {
      const { taskId, phase, moduleName } = payload as { taskId: string; phase: string; moduleName: string };
      const state = await getTaskWorkflowState(String(taskId));
      if (!state) { respond(true, null); return; }
      try {
        const snapshot = JSON.parse(state.workflow_snapshot);
        const step = snapshot.steps?.find((s: any) => s.slug === phase);
        if (!step) { respond(true, null); return; }
        const row = (await db.select().from(stepModuleData)
          .where(and(eq(stepModuleData.task_id, Number(taskId)), eq(stepModuleData.step_id, step.id), eq(stepModuleData.module, moduleName))))[0];
        respond(true, row?.data ?? null);
      } catch { respond(true, null); }
      break;
    }

    case "has_active_tasks": {
      const { projectId } = payload as { projectId: string };
      const rows = await db.select({ deps_cache_volumes: tasks.deps_cache_volumes }).from(tasks)
        .where(and(eq(tasks.project_id, projectId), inArray(tasks.status, ["running", "stopped"])));
      const volumesInUse: string[] = [];
      for (const row of rows) {
        if (row.deps_cache_volumes) {
          try { volumesInUse.push(...JSON.parse(row.deps_cache_volumes) as string[]); } catch {}
        }
      }
      respond(true, { volumesInUse });
      break;
    }

    case "get_project_config": {
      const { projectId } = payload as { projectId: string };
      const cfg = await getProjectConfig(String(projectId), getAgentUserId() ?? undefined);
      respond(true, cfg);
      break;
    }

    case "get_stuck_tasks": {
      const stuck = await readStuckTasks();
      respond(true, stuck);
      break;
    }

    case "get_user_prompt": {
      const { taskId } = payload as { taskId: string };
      const task = await readStatus(String(taskId));
      respond(true, task?.prompt ?? null);
      break;
    }

    case "store_prompt": {
      const { taskId, step, content } = payload as { taskId: string; step: string; content: string };
      await upsertStepPrompt(String(taskId), step, content);
      respond(true);
      break;
    }

    case "store_module_data": {
      const { taskId, phase, module, data } = payload as { taskId: string; phase: string; module: string; data: string };
      const state = await getTaskWorkflowState(String(taskId));
      if (state) {
        try {
          const snapshot = JSON.parse(state.workflow_snapshot);
          const step = snapshot.steps?.find((s: any) => s.slug === phase);
          if (step) {
            await db.insert(stepModuleData)
              .values({ task_id: Number(taskId), step_id: step.id, module, data })
              .onConflictDoUpdate({
                target: [stepModuleData.task_id, stepModuleData.step_id, stepModuleData.module],
                set: { data, updated_at: new Date().toISOString() },
              });
          }
        } catch {}
      }
      respond(true);
      break;
    }

    case "resubmit_step_result": {
      const { taskId, stepSlug, content } = payload as { taskId: string; stepSlug: string; content: string };
      const state = await getTaskWorkflowState(String(taskId));
      const stepId = state ? (() => {
        try { return JSON.parse(state.workflow_snapshot).steps?.find((s: any) => s.slug === stepSlug)?.id ?? 0; }
        catch { return 0; }
      })() : 0;
      await db.insert(stepResults)
        .values({ task_id: Number(taskId), step_id: stepId, result_type: "step", content })
        .onConflictDoUpdate({
          target: [stepResults.task_id, stepResults.step_id],
          set: { content, updated_at: new Date().toISOString() },
        });
      respond(true);
      break;
    }

    default:
      respond(false, undefined, `Unknown agent command: ${command}`);
  }
}
