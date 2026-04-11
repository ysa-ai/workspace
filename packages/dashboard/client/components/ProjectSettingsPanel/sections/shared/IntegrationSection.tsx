import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { trpc } from "../../../../trpc";
import { useToast } from "../../../Toast";
import { Field } from "../../ui";
import { INPUT_BASE, INPUT_CLS, INPUT_MONO_CLS } from "../../types";
import type { SharedFormValues, Project } from "../../types";

export function IntegrationSection({
  editingProject,
  isAdminOrOwner,
}: {
  editingProject: Project | null;
  isAdminOrOwner: boolean;
}) {
  const { register, watch } = useFormContext<SharedFormValues>();
  const issueSource = watch("issue_source");
  const issueSourceLabel = issueSource === "github" ? "GitHub" : "GitLab";

  const [orgTokenInput, setOrgTokenInput] = useState("");
  const showToast = useToast();
  const utils = trpc.useUtils();

  const { data: projectTokenData } = trpc.auth.getProjectToken.useQuery(
    { projectId: editingProject?.project_id ?? "" },
    { enabled: !!editingProject },
  );
  const updateProjectTokenMutation = trpc.auth.updateProjectToken.useMutation({
    onSuccess: () => {
      utils.auth.getProjectToken.invalidate();
      setOrgTokenInput("");
      showToast("Token saved", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  return (
    <div className="space-y-4">
      <Field label="Issue source">
        <select {...register("issue_source")} className={`${INPUT_CLS} cursor-pointer`}>
          <option value="gitlab">GitLab</option>
          <option value="github">GitHub</option>
        </select>
      </Field>
      <Field
        label="Issue URL template"
        hint={
          issueSource === "github"
            ? "Use {id} as placeholder, e.g. https://github.com/org/repo/issues/{id}"
            : "Use {id} as placeholder, e.g. https://gitlab.com/org/repo/-/issues/{id}"
        }
      >
        <div className="flex gap-2">
          <input
            {...register("issue_url_template")}
            className={INPUT_MONO_CLS}
            placeholder={
              issueSource === "github"
                ? "https://github.com/org/repo/issues/{id}"
                : "https://gitlab.com/org/repo/-/issues/{id}"
            }
          />
          {issueSource !== "github" && editingProject && (
            <div className="flex flex-col gap-1 shrink-0">
              <span className="text-xs text-gray-400">Project ID</span>
              <input
                readOnly
                value={editingProject.gitlab_project_id ?? ""}
                placeholder="—"
                className="bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary w-28 cursor-default opacity-60 text-center focus:outline-none pointer-events-none"
              />
            </div>
          )}
        </div>
      </Field>
      <Field
        label="Code repository URL"
        hint="Repository where code changes are pushed (if different from issue tracker)"
      >
        <input
          {...register("code_repo_url")}
          className={INPUT_MONO_CLS}
          placeholder="https://github.com/org/repo"
        />
      </Field>
      {isAdminOrOwner && editingProject && (
        <Field label={`${issueSourceLabel} access token`}>
          <div className="flex gap-2">
            <input
              type="password"
              value={orgTokenInput}
              onChange={(e) => setOrgTokenInput(e.target.value)}
              className={`${INPUT_BASE} flex-1 min-w-0 font-mono`}
              placeholder={
                projectTokenData?.has_token
                  ? "Token set — enter a new one to replace"
                  : issueSource === "github"
                    ? "ghp_xxxxxxxxxxxxxxxxxxxx"
                    : "glpat-xxxxxxxxxxxxxxxxxxxx"
              }
              autoComplete="new-password"
            />
            <button
              type="button"
              disabled={!orgTokenInput || updateProjectTokenMutation.isPending}
              onClick={() => updateProjectTokenMutation.mutate({ projectId: editingProject!.project_id, token: orgTokenInput })}
              className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
            {projectTokenData?.has_token && (
              <button
                type="button"
                onClick={() => updateProjectTokenMutation.mutate({ projectId: editingProject!.project_id, token: null })}
                className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-err hover:border-err/40 transition-all cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-warn/80">
            <svg className="shrink-0 mt-px" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Shared with all team members. Each developer can override it under <span className="font-medium">Personal → Access Token</span>.</span>
          </div>
        </Field>
      )}
    </div>
  );
}
