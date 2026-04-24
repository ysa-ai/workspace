import { useState } from "react";
import { Stepper } from "./Stepper";
import { formatDuration, useLiveTick, displayTaskId } from "../lib/format";
import { trpc } from "../trpc";
import { useToast } from "./Toast";
import { useAuth } from "../AuthProvider";

export interface TaskData {
  task_id: number;
  step: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  plan_summary: string | null;
  mr_url: string | null;
  error: string | null;
  session_id: string | null;
  failure_reason: string | null;
  issue_url?: string;
  available_logs?: string[];
  phase_timings?: string | null;
  llm_provider?: string | null;
  llm_model?: string | null;
  issue_source?: string | null;
  source_type?: string | null;
  title?: string | null;
  // Workflow state (populated when task has a workflow state)
  workflow_steps?: { id: number; slug: string; name: string; position: number; modules?: { name: string; prompt: string }[] }[];
  current_step_slug?: string;
  current_step_name?: string;
  step_transitions?: { id: number; toStepId: number | null; label: string | null; isDefault: boolean }[];
  step_history?: { stepId: number; slug: string; startedAt: string; finishedAt: string | null; status: string }[];
  created_by?: number | null;
}

// Backwards-compat alias
export type IssueData = TaskData;

const STATUS_DOT: Record<string, string> = {
  starting: "bg-primary",
  running: "bg-primary",
  step_done: "bg-ok",
  stopped: "bg-warn",
  failed: "bg-err",
  cleaned_up: "bg-text-faint/50",
};

interface TaskRowProps {
  issue: TaskData;
  selected: boolean;
  focused: boolean;
  onSelect: (id: number) => void;
  issueUrlTemplate?: string;
}

export function TaskRow({ issue, selected, focused, onSelect, issueUrlTemplate }: TaskRowProps) {
  const isPrompt = issue.source_type === "prompt";
  const issueUrl = !isPrompt ? (issue.issue_url || (issueUrlTemplate ? issueUrlTemplate.replace("{id}", String(issue.task_id)) : null)) : null;
  const summary = isPrompt && issue.title
    ? issue.title
    : issue.plan_summary || issue.error || issue.current_step_name || issue.current_step_slug || issue.step || "";
  const truncated = summary.length > 80 ? summary.slice(0, 77) + "..." : summary;
  const dotColor = STATUS_DOT[issue.status] || "bg-muted";
  const isRunning = issue.status === "running" || issue.status === "starting";
  useLiveTick(isRunning);
  const showToast = useToast();
  const utils = trpc.useUtils();
  const { user, orgs } = useAuth();
  const myRole = orgs.find((o) => o.id === user?.orgId)?.role ?? "member";
  const canDelete = myRole === "owner" || myRole === "admin" || issue.created_by === user?.id;

  const tid = displayTaskId(issue.task_id, issue.source_type);

  const cleanupMutation = trpc.actions.cleanup.useMutation({
    onSuccess: () => {
      showToast(`Task ${tid}: archived`, "success");
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const deleteMutation = trpc.actions.delete.useMutation({
    onSuccess: () => {
      showToast(`Task ${tid}: deleted`, "success");
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const canArchive = !["cleaned_up", "running", "starting"].includes(issue.status);
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      data-onboarding={`task-row-${issue.task_id}`}
      className={`group w-full text-left px-4 py-3 flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
        selected
          ? "bg-primary-subtle border-l-primary"
          : focused
            ? "bg-bg-surface border-l-text-faint"
            : "border-l-transparent hover:bg-bg-surface/60"
      } ${issue.status === "cleaned_up" ? "opacity-55" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        onSelect(issue.task_id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(issue.task_id);
        }
      }}
    >
      {/* Left: status dot + task id/title + timer */}
      <div className="flex flex-col items-start shrink-0 w-18">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${isRunning ? "animate-[pulse_1.5s_infinite]" : ""}`} />
          {isPrompt ? (
            <span className="text-[11px] font-semibold text-text-primary bg-bg-surface border border-border rounded px-2 py-0.5">
              Prompt
            </span>
          ) : issueUrl ? (
            <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] font-bold leading-snug text-primary hover:underline">
              #{issue.task_id}
            </a>
          ) : (
            <span className={`text-[13px] font-bold leading-snug ${selected ? "text-text-primary" : "text-text-secondary"}`}>
              #{issue.task_id}
            </span>
          )}
        </div>
        <span className="text-[10px] text-text-faint font-mono mt-0.5 pl-4">
          {formatDuration(issue.started_at, issue.finished_at)}
        </span>
      </div>

      {/* Middle: summary + stepper */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
        {truncated && (
          <span className="text-[12px] text-text-muted truncate">{truncated}</span>
        )}
        <Stepper phase={issue.current_step_slug ?? issue.step} status={issue.status} workflowSteps={issue.workflow_steps} />
      </div>

      {/* Right: hover actions */}
      <div className={`transition-opacity flex items-center gap-0.5 shrink-0 ${cleanupMutation.isPending || deleteMutation.isPending ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        {canArchive && (
          <button
            className="p-1.5 rounded text-text-faint hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer disabled:cursor-default"
            title="Archive"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setConfirmAction("archive");
            }}
            disabled={cleanupMutation.isPending || deleteMutation.isPending}
          >
            {cleanupMutation.isPending ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}
        {canDelete && <button
          className="p-1.5 rounded text-text-faint hover:text-err hover:bg-err-bg transition-colors cursor-pointer disabled:cursor-default"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setConfirmAction("delete");
          }}
          disabled={deleteMutation.isPending || cleanupMutation.isPending}
        >
          {deleteMutation.isPending ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>}
      </div>
    </div>

    {confirmAction && (

      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" onClick={() => setConfirmAction(null)}>
        <div className="bg-bg-raised border border-border rounded-xl shadow-xl p-5 w-[320px]" onClick={(e) => e.stopPropagation()}>
          <p className="text-[14px] font-semibold text-text-primary mb-1">
            {confirmAction === "delete" ? "Delete task?" : "Archive task?"}
          </p>
          <p className="text-[12px] text-text-muted mb-4">
            {confirmAction === "delete"
              ? `Task ${tid} and all its data will be permanently removed.`
              : `Task ${tid} will be archived and its worktree cleaned up.`}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setConfirmAction(null)}
              className="px-3 py-1.5 rounded-lg text-[12px] border border-border text-text-muted hover:bg-bg-surface cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (confirmAction === "delete") deleteMutation.mutate({ id: String(issue.task_id) });
                else cleanupMutation.mutate({ id: String(issue.task_id) });
                setConfirmAction(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer text-white ${confirmAction === "delete" ? "bg-err hover:brightness-110" : "bg-primary hover:brightness-110"}`}
            >
              {confirmAction === "delete" ? "Delete" : "Archive"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// Backwards-compat alias
export const IssueRow = TaskRow;
