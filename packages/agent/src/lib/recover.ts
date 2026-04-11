import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../logger";
import { sendToDashboard, requestFromDashboard } from "../ws/send.js";

interface StuckIssue {
  task_id: number;
  step: string;
  status: string;
  session_id?: string | null;
  project_id?: string | null;
}

async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function runShell(cmd: string): Promise<{ ok: boolean; stdout: string }> {
  const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout: stdout.trim() };
}

function extractSessionId(logContent: string): string | null {
  const matches = logContent.match(/"session_id":"([^"]*)"/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return last.match(/"session_id":"([^"]*)"/)?.[1] ?? null;
}

async function isContainerRunning(issueId: string): Promise<boolean> {
  const r = await runShell(`podman inspect --format '{{.State.Running}}' sandbox-${issueId} 2>/dev/null`);
  return r.ok && r.stdout === "true";
}

async function waitForContainer(issueId: string): Promise<void> {
  await runShell(`podman wait sandbox-${issueId} 2>/dev/null`);
}

async function hasDataInDashboard(issueId: string, phase: string): Promise<boolean> {
  try {
    const content = await requestFromDashboard<string | null>({
      type: "agent_request",
      command: "get_step_result",
      payload: { taskId: issueId, stepSlug: phase },
    });
    return content !== null;
  } catch {
    return false;
  }
}

async function resubmitFromFile(issueId: string, phase: string, worktreePrefix: string): Promise<boolean> {
  const filePath = `${worktreePrefix}${issueId}/.ysa-result-${phase}.json`;
  if (!(await fileExists(filePath))) return false;
  try {
    const content = await readFile(filePath, "utf-8");
    await requestFromDashboard<unknown>({
      type: "agent_request",
      command: "resubmit_step_result",
      payload: { taskId: issueId, stepSlug: phase, content },
    });
    log.info(`Recovered task #${issueId} ${phase} data from file`);
    return true;
  } catch (err: any) {
    log.warn(`Failed to resubmit for task #${issueId}: ${err.message}`);
    return false;
  }
}

async function fetchProjectConfig(projectId: string | null | undefined): Promise<{ worktreePrefix: string; projectRoot: string }> {
  if (!projectId) return { worktreePrefix: "", projectRoot: "" };
  try {
    const cfg = await requestFromDashboard<Record<string, unknown>>({
      type: "agent_request",
      command: "get_project_config",
      payload: { projectId },
    });
    return {
      worktreePrefix: (cfg.worktreePrefix as string) || "",
      projectRoot: (cfg.projectRoot as string) || "",
    };
  } catch {
    return { worktreePrefix: "", projectRoot: "" };
  }
}

async function recoverSingle(
  issue: StuckIssue,
  worktreePrefix: string,
  projectRoot: string,
): Promise<void> {
  const issueId = String(issue.task_id);
  const phase = issue.step;

  try {
    let hasData = await hasDataInDashboard(issueId, phase);

    if (!hasData && worktreePrefix) {
      hasData = await resubmitFromFile(issueId, phase, worktreePrefix);
    }

    let sessionId: string | null = issue.session_id ?? null;
    const logPath = projectRoot
      ? join(projectRoot, ".ysa", "logs", `${issueId}-${phase}.log`)
      : "";
    if (!sessionId && logPath && (await fileExists(logPath))) {
      try {
        const logContent = await readFile(logPath, "utf-8");
        sessionId = extractSessionId(logContent);
      } catch {}
    }

    const statusUpdate: Record<string, unknown> = { finished_at: new Date().toISOString() };
    if (sessionId) statusUpdate.session_id = sessionId;

    if (hasData) {
      statusUpdate.status = "step_done";
      log.info(`Task #${issueId}: recovered → step_done`);
    } else {
      statusUpdate.status = "failed";
      statusUpdate.failure_reason = "infrastructure";
      statusUpdate.error = "Server restarted while phase was running";
      log.warn(`Task #${issueId}: no data found, marking failed`);
    }

    sendToDashboard({ type: "status_update", taskId: issueId, status: statusUpdate });
  } catch (err: any) {
    log.error(`Recovery error for task #${issueId}: ${err.message}`);
  }
}

export async function recoverStuckTasks(): Promise<void> {
  try {
    const stuck = await requestFromDashboard<StuckIssue[]>({
      type: "agent_request",
      command: "get_stuck_tasks",
      payload: {},
    });

    if (stuck.length === 0) return;
    log.info(`Found ${stuck.length} stuck task(s), recovering...`);

    for (const issue of stuck) {
      const issueId = String(issue.task_id);
      const { worktreePrefix, projectRoot } = await fetchProjectConfig(issue.project_id);
      try {
        const running = await isContainerRunning(issueId);
        if (running) {
          waitForContainer(issueId)
            .then(() => recoverSingle(issue, worktreePrefix, projectRoot))
            .catch((err: any) => log.error(`Re-attach error for task #${issueId}: ${err.message}`));
        } else {
          await recoverSingle(issue, worktreePrefix, projectRoot);
        }
      } catch (err: any) {
        log.error(`Recovery check error for task #${issueId}: ${err.message}`);
      }
    }
  } catch (err: any) {
    log.error(`recoverStuckTasks failed: ${err.message}`);
  }
}
