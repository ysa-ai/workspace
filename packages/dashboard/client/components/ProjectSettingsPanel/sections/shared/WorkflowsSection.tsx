import { useState } from "react";
import { trpc } from "../../../../trpc";
import { useToast } from "../../../Toast";

export function WorkflowsSection({
  projectId,
  currentWorkflowId,
  isAdminOrOwner,
  onEdit,
  onNew,
}: {
  projectId: string | null;
  currentWorkflowId: number | null;
  isAdminOrOwner: boolean;
  onEdit: (id: number) => void;
  onNew: () => void;
}) {
  const showToast = useToast();
  const utils = trpc.useUtils();

  const { data: workflows = [], isLoading } = trpc.workflows.list.useQuery();
  const [activeWorkflowId, setActiveWorkflowId] = useState<number | null>(currentWorkflowId);

  const setWorkflowMutation = trpc.projects.setWorkflow.useMutation({
    onSuccess: (_, vars) => {
      utils.projects.invalidate();
      setActiveWorkflowId(vars.workflowId);
      showToast("Project workflow updated", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const deleteMutation = trpc.workflows.delete.useMutation({
    onSuccess: () => {
      utils.workflows.invalidate();
      showToast("Workflow deleted", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const duplicateMutation = trpc.workflows.duplicate.useMutation({
    onSuccess: (wf) => {
      utils.workflows.invalidate();
      showToast(`Duplicated as "${wf.name}"`, "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-muted">
          {workflows.length} workflow{workflows.length !== 1 ? "s" : ""} available
        </p>
        {isAdminOrOwner && (
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-colors cursor-pointer"
            onClick={onNew}
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Workflow
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-[13px] text-text-faint py-4 text-center">Loading workflows...</div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-bg-inset cursor-pointer"
              onClick={() => onEdit(wf.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary">{wf.name}</span>
                  {wf.is_builtin && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium border border-border bg-bg-surface text-text-muted">Builtin</span>
                  )}
                </div>
                {wf.description && (
                  <div className="text-[11px] text-text-faint mt-0.5 truncate">{wf.description}</div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(!projectId && wf.is_builtin) || (projectId && activeWorkflowId === wf.id) ? (
                  <span className="px-2.5 py-1 rounded text-[11px] font-medium border border-ok/30 bg-ok/10 text-ok">
                    Active
                  </span>
                ) : projectId && isAdminOrOwner ? (
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded text-[11px] font-medium border border-border text-text-muted hover:text-primary hover:border-primary/30 transition-colors cursor-pointer"
                    title="Use for this project"
                    onClick={(e) => {
                      e.stopPropagation();
                      setWorkflowMutation.mutate({ projectId, workflowId: wf.id });
                    }}
                    disabled={setWorkflowMutation.isPending}
                  >
                    Use
                  </button>
                ) : null}
                {isAdminOrOwner && (
                  <button
                    type="button"
                    className="p-1.5 rounded text-text-faint hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(wf.id);
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
                {isAdminOrOwner && (
                  <button
                    type="button"
                    className="p-1.5 rounded text-text-faint hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
                    title="Duplicate"
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicateMutation.mutate({ workflowId: wf.id });
                    }}
                    disabled={duplicateMutation.isPending}
                  >
                    <svg
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      viewBox="0 0 24 24"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path
                        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
                {isAdminOrOwner && !wf.is_builtin && (
                  <button
                    type="button"
                    className="p-1.5 rounded text-text-faint hover:text-err hover:bg-err-bg transition-colors cursor-pointer"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete workflow "${wf.name}"?`)) {
                        deleteMutation.mutate({ workflowId: wf.id });
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <svg
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
