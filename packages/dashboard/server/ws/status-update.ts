import { patchStatus, readStatus, getTaskWorkflowState, markWorkflowStepComplete } from "../lib/status";
import { db } from "../db";
import { stepModuleData } from "../db/schema";
import { eq } from "drizzle-orm";
import { getProjectConfig } from "../lib/project-bootstrap";
import { unblockDependents } from "../lib/blockers";
import { log } from "../logger";
import { sendAgentCommand, getAgentUserId } from "./handler";

export async function handleStatusUpdate(taskId: string, body: Record<string, unknown>): Promise<void> {
  if (body.status === "failed") {
    const current = await readStatus(taskId);
    if (current?.status === "stopped") return;
  }

  const PHASE_DONE_STATUSES = ["step_done", "failed"];
  if (body.status && PHASE_DONE_STATUSES.includes(body.status as string)) {
    const current = await readStatus(taskId);
    if (current?.step) {
      const timings: Record<string, { segments?: { started_at: string; elapsed_ms: number | null }[] }> = (() => {
        try { return JSON.parse((current as any).phase_timings || "{}"); } catch { return {}; }
      })();
      const segments = timings[current.step]?.segments ?? [];
      const lastOpen = [...segments].reverse().find((s) => s.elapsed_ms === null);
      const elapsedMs = (body.elapsed_ms as number | undefined) ?? (lastOpen ? Date.now() - new Date(lastOpen.started_at).getTime() : 0);
      const updated = segments.map((s, i, arr) =>
        i === arr.length - 1 && s.elapsed_ms === null ? { ...s, elapsed_ms: elapsedMs } : s,
      );
      body.phase_timings = JSON.stringify({ ...timings, [current.step]: { segments: updated } });
    }
  }

  await patchStatus(taskId, body);

  const TERMINAL_STATUSES = ["step_done", "failed"];
  if (body.status && TERMINAL_STATUSES.includes(body.status as string)) {
    const wsState = await getTaskWorkflowState(taskId);
    if (wsState?.current_step_id) {
      const stepStatus = body.status === "failed" ? "failed" : "done";
      await markWorkflowStepComplete(taskId, wsState.current_step_id, new Date().toISOString(), stepStatus);

      if (body.status === "step_done") {
        try {
          const snapshot = JSON.parse(wsState.workflow_snapshot);
          const currentStep = (snapshot.steps ?? []).find((s: any) => s.id === wsState.current_step_id);
          const hasNext = (snapshot.transitions ?? []).some(
            (t: any) => t.fromStepId === wsState.current_step_id && t.isDefault && t.toStepId != null,
          );

          const hasChangeReport = ((currentStep?.modules ?? []) as { name: string }[]).some((m) => m.name === "change_report");
          if (hasChangeReport) {
            const agentUserId = getAgentUserId();
            const status = await readStatus(taskId);
            if (agentUserId && status?.project_id) {
              const cfg = await getProjectConfig(status.project_id, agentUserId);
              if (cfg.worktreePrefix) {
                const worktree = `${cfg.worktreePrefix}${taskId}`;
                sendAgentCommand("get_git_info", { worktree }, 15000)
                  .then(async (ack) => {
                    const diff = (ack.data as any)?.diff as string | undefined;
                    if (diff?.trim()) {
                      await db.insert(stepModuleData)
                        .values({ task_id: parseInt(taskId), step_id: wsState.current_step_id!, module: "change_report", data: diff })
                        .onConflictDoUpdate({ target: [stepModuleData.task_id, stepModuleData.step_id, stepModuleData.module], set: { data: diff } });
                    }
                  })
                  .catch((err: any) => log.warn(`Failed to capture change_report for task ${taskId}: ${err.message}`));
              }
            }
          }

          if (!hasNext && currentStep?.autoAdvance) {
            await patchStatus(taskId, { status: "cleaned_up", finished_at: new Date().toISOString() });
          }
        } catch { /* snapshot parse error */ }
      }
    }
  }

  if (body.status === "finalized") {
    const status = await readStatus(taskId);
    const agentUserId = getAgentUserId();
    if (status?.project_id && agentUserId) {
      const cfg = await getProjectConfig(status.project_id, agentUserId);
      unblockDependents(cfg, parseInt(taskId)).catch((e: any) =>
        log.error(`Failed to unblock dependents of #${taskId}: ${e.message}`),
      );
    }
  }
}
