import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { trpc } from "../../../../trpc";
import { useToast } from "../../../Toast";
import { Field } from "../../ui";
import { INPUT_CLS, INPUT_MONO_CLS } from "../../types";
import type { SharedFormValues, Project } from "../../types";

export function GeneralSection({
  editingProject,
  isAdminOrOwner,
  onEditWorkflow,
}: {
  editingProject: Project | null;
  isAdminOrOwner: boolean;
  onEditWorkflow?: (id: number) => void;
}) {
  const { register } = useFormContext<SharedFormValues>();

  return (
    <div className="space-y-4">
      <Field label="Project name" required>
        <input
          {...register("name", { required: true })}
          className={INPUT_CLS}
          placeholder="my-project"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Branch prefix">
          <input {...register("branch_prefix")} className={INPUT_MONO_CLS} placeholder="fix/" />
        </Field>
        <Field label="Default branch">
          <input {...register("default_branch")} className={INPUT_MONO_CLS} placeholder="main" />
        </Field>
      </div>
      {isAdminOrOwner && editingProject && (
        <WorkflowPicker
          projectId={editingProject.project_id}
          currentWorkflowId={editingProject.workflow_id}
          onEdit={onEditWorkflow}
        />
      )}
    </div>
  );
}

function WorkflowPicker({ projectId, currentWorkflowId, onEdit }: {
  projectId: string;
  currentWorkflowId: number | null;
  onEdit?: (id: number) => void;
}) {
  const showToast = useToast();
  const utils = trpc.useUtils();
  const { data: workflows = [], isLoading } = trpc.workflows.list.useQuery();
  const [activeId, setActiveId] = useState<number | null>(currentWorkflowId);

  const setWorkflowMutation = trpc.projects.setWorkflow.useMutation({
    onSuccess: (_, vars) => {
      utils.projects.invalidate();
      setActiveId(vars.workflowId);
      showToast("Workflow updated", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const effectiveId = activeId ?? (workflows.length > 0 ? (workflows[0] as any).id : null);

  return (
    <Field label="Workflow">
      {isLoading ? (
        <div className="text-[12px] text-text-faint py-2">Loading workflows…</div>
      ) : (
        <div className="space-y-1.5">
          {(workflows as any[]).map((wf) => {
            const isSelected = effectiveId === wf.id;
            return (
              <div
                key={wf.id}
                onClick={() => { if (!isSelected) setWorkflowMutation.mutate({ projectId, workflowId: wf.id }); }}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  isSelected ? "border-primary/40 bg-primary/5" : "border-border bg-bg-inset hover:border-border-bright"
                }`}
              >
                <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${isSelected ? "border-primary" : "border-border"}`}>
                  {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-text-primary">{wf.name}</span>
                    {wf.is_builtin && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium border border-border bg-bg-surface text-text-muted">Builtin</span>
                    )}
                  </div>
                  {wf.description && (
                    <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{wf.description}</p>
                  )}
                </div>
                {onEdit && (
                  <button
                    type="button"
                    title="Open workflow"
                    onClick={(e) => { e.stopPropagation(); onEdit(wf.id); }}
                    className="shrink-0 p-1 rounded text-text-faint hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
                  >
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Field>
  );
}
