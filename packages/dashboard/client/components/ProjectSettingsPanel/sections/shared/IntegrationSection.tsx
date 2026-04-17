import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { trpc } from "../../../../trpc";
import { useToast } from "../../../Toast";
import { Field } from "../../ui";
import { INPUT_BASE, INPUT_CLS, INPUT_MONO_CLS } from "../../types";
import type { SharedFormValues, Project } from "../../types";

const PAT_SCOPES: Record<string, { scopes: string[]; url: string; label: string }> = {
  gitlab: {
    label: "GitLab",
    scopes: ["api"],
    url: "https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html",
  },
  github: {
    label: "GitHub",
    scopes: ["repo"],
    url: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
  },
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-border">
      <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">{children}</span>
    </div>
  );
}

function TokenScopeCard({ scopes, docUrl, description }: { scopes: string[]; docUrl: string; description: string }) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-bg-inset border border-border text-[12px]">
      <svg className="shrink-0 mt-0.5 text-primary/70" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-text-muted mb-1.5">{description}</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[11px] text-text-faint">Required scope{scopes.length > 1 ? "s" : ""}:</span>
          {scopes.map((s) => (
            <code key={s} className="px-1.5 py-0.5 rounded bg-bg-surface border border-border text-[11px] font-mono text-text-primary">{s}</code>
          ))}
          <a href={docUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-primary/80 hover:text-primary transition-colors whitespace-nowrap">
            Create token →
          </a>
        </div>
      </div>
    </div>
  );
}

export function IntegrationSection({
  editingProject,
  isAdminOrOwner,
}: {
  editingProject: Project | null;
  isAdminOrOwner: boolean;
}) {
  const { register, watch } = useFormContext<SharedFormValues>();
  const issueSource = watch("issue_source");
  const providerInfo = PAT_SCOPES[issueSource ?? "gitlab"] ?? PAT_SCOPES.gitlab;

  const [orgTokenInput, setOrgTokenInput] = useState("");
  const [codeTokenInput, setCodeTokenInput] = useState("");
  const showToast = useToast();
  const utils = trpc.useUtils();

  const { data: projectTokenData } = trpc.auth.getProjectToken.useQuery(
    { projectId: editingProject?.project_id ?? "" },
    { enabled: !!editingProject },
  );
  const updateProjectTokenMutation = trpc.auth.updateProjectToken.useMutation({
    onSuccess: () => {
      utils.auth.getProjectToken.invalidate();
      utils.tasks.browse.invalidate();
      setOrgTokenInput("");
      showToast("Token saved", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const { data: userSettingsData } = trpc.projects.getUserSettings.useQuery(
    { projectId: editingProject?.project_id ?? "" },
    { enabled: !!editingProject },
  );
  const updateUserSettingsMutation = trpc.projects.updateUserSettings.useMutation({
    onSuccess: () => {
      utils.projects.getUserSettings.invalidate();
      setCodeTokenInput("");
      showToast("Token saved", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  return (
    <div className="space-y-6">
      {/* Issue source */}
      <div className="space-y-4">
        <SectionTitle>Issue source</SectionTitle>
        <Field label="Provider">
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
        {isAdminOrOwner && editingProject && (
          <div className="space-y-2">
            <Field label={`${providerInfo.label} access token`} hint="Shared across your organization.">
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
            </Field>
            <TokenScopeCard
              scopes={providerInfo.scopes}
              docUrl={providerInfo.url}
              description="Used to read issues, post comments, and create MRs/PRs."
            />
          </div>
        )}
      </div>

      {/* Code repository */}
      <div className="space-y-4">
        <SectionTitle>Code repository</SectionTitle>
        <Field
          label="Repository URL"
          hint="Repository where code changes are pushed. Leave empty if it's the same host as the issue source."
        >
          <input
            {...register("code_repo_url")}
            className={INPUT_MONO_CLS}
            placeholder="https://github.com/org/repo"
          />
        </Field>
        {editingProject && (
          <div className="space-y-2">
            <Field label="Git access token" hint="Falls back to the issue source token if not set.">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={codeTokenInput}
                  onChange={(e) => setCodeTokenInput(e.target.value)}
                  className={`${INPUT_BASE} flex-1 min-w-0 font-mono`}
                  placeholder={
                    userSettingsData?.code_repo_token !== undefined && userSettingsData?.code_repo_token !== null
                      ? "Token set — enter a new one to replace"
                      : "glpat-xxxxxxxxxxxxxxxxxxxx"
                  }
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  disabled={!codeTokenInput || updateUserSettingsMutation.isPending}
                  onClick={() => updateUserSettingsMutation.mutate({ projectId: editingProject!.project_id, code_repo_token: codeTokenInput })}
                  className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save
                </button>
                {userSettingsData?.code_repo_token !== undefined && userSettingsData?.code_repo_token !== null && (
                  <button
                    type="button"
                    onClick={() => updateUserSettingsMutation.mutate({ projectId: editingProject!.project_id, code_repo_token: null })}
                    className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-err hover:border-err/40 transition-all cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </Field>
            <TokenScopeCard
              scopes={issueSource === "github" ? ["repo"] : ["write_repository"]}
              docUrl={providerInfo.url}
              description="Used for git push over HTTPS."
            />
          </div>
        )}
      </div>
    </div>
  );
}
