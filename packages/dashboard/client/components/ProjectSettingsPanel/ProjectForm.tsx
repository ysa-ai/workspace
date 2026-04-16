import { useState, useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { trpc } from "../../trpc";
import { useToast } from "../Toast";
import {
  type Project,
  type SharedFormValues,
  type UserFormValues,
  SHARED_SECTIONS,
  PERSONAL_SECTIONS,
  PERSONAL_SECTION_IDS,
  isSectionDirty,
  defaultSharedValues,
  defaultUserValues,
  parseWorktreeFiles,
  parseDevServers,
  serializeWorktreeFiles,
  serializeDevServers,
} from "./types";
import { GeneralSection } from "./sections/shared/GeneralSection";
import { IntegrationSection } from "./sections/shared/IntegrationSection";
import { BuildSection } from "./sections/shared/BuildSection";
import { SecuritySection } from "./sections/shared/SecuritySection";
import { AdvancedSection } from "./sections/shared/AdvancedSection";
import { PathsSection } from "./sections/personal/PathsSection";
import { AISettingsSection } from "./sections/personal/AISettingsSection";
import { ContainerSection } from "./sections/shared/ContainerSection";

function buildSharedValues(project: Project): SharedFormValues {
  return {
    name: project.name,
    branch_prefix: project.branch_prefix,
    default_branch: project.default_branch,
    issue_source: project.issue_source || "gitlab",
    issue_url_template: project.issue_url_template,
    code_repo_url: project.code_repo_url || "",
    worktree_files: parseWorktreeFiles(project.worktree_files).map((v) => ({ value: v })),
    languages: (() => {
      try {
        return JSON.parse(project.languages ?? "[]");
      } catch {
        return [];
      }
    })(),
    network_policy: project.network_policy,
    install_cmd: project.install_cmd || "",
    build_cmd: project.build_cmd || "",
    pre_dev_cmd: project.pre_dev_cmd || "",
    dev_servers: parseDevServers(project.dev_servers),
    test_cmd: project.test_cmd || "",
    deps_cache_files: (() => { try { const a = JSON.parse(project.deps_cache_files ?? "[]"); return Array.isArray(a) ? a.join("\n") : ""; } catch { return ""; } })(),
  };
}

function buildSharedPayload(values: SharedFormValues) {
  return {
    name: values.name,
    branch_prefix: values.branch_prefix || undefined,
    default_branch: values.default_branch || undefined,
    issue_source: values.issue_source as "gitlab" | "github",
    issue_url_template: values.issue_url_template || undefined,
    code_repo_url: values.code_repo_url || null,
    worktree_files: serializeWorktreeFiles(values.worktree_files.map((f) => f.value)),
    languages: values.languages.length ? JSON.stringify(values.languages) : null,
    network_policy: values.network_policy as "none" | "strict" | "custom",
    install_cmd: values.install_cmd || null,
    build_cmd: values.build_cmd || null,
    pre_dev_cmd: values.pre_dev_cmd || null,
    dev_servers: serializeDevServers(values.dev_servers),
    test_cmd: values.test_cmd || null,
    deps_cache_files: (() => { const lines = values.deps_cache_files.split("\n").map((l) => l.trim()).filter(Boolean); return lines.length ? JSON.stringify(lines) : null; })(),
  };
}

function buildUserPayload(values: UserFormValues) {
  return {
    project_root: values.project_root || undefined,
    worktree_prefix: values.worktree_prefix || undefined,
    npmrc_path: values.npmrc_path || null,
    env_vars: values.env_vars || null,
    mcp_config: values.mcp_config || null,
    container_memory: values.container_memory || null,
    container_cpus: values.container_cpus || null,
    container_pids_limit: values.container_pids_limit || null,
    container_timeout: values.container_timeout || null,
  };
}

export function ProjectForm({
  editingProject,
  isAdminOrOwner,
  initialSection,
  onBack,
  onClose,
  onSwitchProject,
  onEditWorkflow,
}: {
  editingProject: Project | null;
  isAdminOrOwner: boolean;
  initialSection: string;
  onBack: () => void;
  onClose: () => void;
  onSwitchProject?: (projectId: string) => void;
  onEditWorkflow?: (id: number) => void;
}) {
  const [activeSection, setActiveSection] = useState(initialSection);
  const [activeGroup, setActiveGroup] = useState<"shared" | "personal">(
    PERSONAL_SECTION_IDS.has(initialSection) ? "personal" : "shared",
  );

  const sharedForm = useForm<SharedFormValues>({
    defaultValues: editingProject ? buildSharedValues(editingProject) : defaultSharedValues,
  });
  const userForm = useForm<UserFormValues>({ defaultValues: defaultUserValues });

  const showToast = useToast();
  const utils = trpc.useUtils();

  const { data: userSettingsData } = trpc.projects.getUserSettings.useQuery(
    { projectId: editingProject?.project_id ?? "" },
    { enabled: !!editingProject },
  );

  useEffect(() => {
    if (userSettingsData) {
      userForm.reset({
        project_root: userSettingsData.project_root ?? "",
        worktree_prefix: userSettingsData.worktree_prefix ?? "",
        npmrc_path: userSettingsData.npmrc_path ?? "",
        env_vars: userSettingsData.env_vars ?? "",
        mcp_config: userSettingsData.mcp_config ?? "",
        container_memory: userSettingsData.container_memory ?? "4g",
        container_cpus: userSettingsData.container_cpus ?? 2,
        container_pids_limit: userSettingsData.container_pids_limit ?? 512,
        container_timeout: userSettingsData.container_timeout ?? 3600,
      });
    }
  }, [userSettingsData]);

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      utils.projects.invalidate();
      onSwitchProject?.(project.project_id);
      onClose();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const [showingBuild, setShowingBuild] = useState(false);

  const updateMutation = trpc.projects.update.useMutation({
    onSuccess: (data) => {
      utils.projects.invalidate();
      utils.tasks.invalidate();
      utils.system.invalidate();
      if (data.buildTriggered) {
        setShowingBuild(true);
        setActiveSection("build");
        showToast("Building runtime image…", "success");
      } else {
        showToast("Project updated", "success");
        onClose();
      }
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const updateUserSettingsMutation = trpc.projects.updateUserSettings.useMutation({
    onSuccess: () => {
      utils.projects.getUserSettings.invalidate();
      showToast("Saved", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const onSharedSubmit = (values: SharedFormValues) => {
    if (editingProject) {
      if (!isAdminOrOwner) return;
      updateMutation.mutate({ projectId: editingProject.project_id, ...buildSharedPayload(values) });
    } else {
      createMutation.mutate({ ...buildSharedPayload(values), ...buildUserPayload(userForm.getValues()) });
    }
  };

  const onUserSubmit = (values: UserFormValues) => {
    if (!editingProject) return;
    updateUserSettingsMutation.mutate(
      { projectId: editingProject.project_id, ...buildUserPayload(values) },
      {
        onSuccess: () => {
          userForm.reset(values);
        },
      },
    );
  };

  const goBack = () => {
    const isDirty = sharedForm.formState.isDirty || userForm.formState.isDirty;
    if (isDirty && !confirm("You have unsaved changes. Leave without saving?")) return;
    onBack();
  };

  const selectSection = (id: string) => {
    const isPersonal = PERSONAL_SECTION_IDS.has(id);
    setActiveGroup(isPersonal ? "personal" : "shared");
    setActiveSection(id);
  };

  const activeSections = activeGroup === "shared" ? SHARED_SECTIONS : PERSONAL_SECTIONS;
  const isPending = createMutation.isPending || updateMutation.isPending || updateUserSettingsMutation.isPending;
  const sharedDirtyFields = sharedForm.formState.dirtyFields;
  const userDirtyFields = userForm.formState.dirtyFields;

  const issueSource = sharedForm.watch("issue_source");
  const issueSourceLabel = issueSource === "github" ? "GitHub" : "GitLab";
  const projectRoot = userForm.watch("project_root");
  const sharedName = sharedForm.watch("name");

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-raised">
      {/* Form header */}
      <div className="p-5 pb-4 border-b border-border relative shrink-0">
        <div className="flex items-center gap-2 mb-1.5">
          <button
            className="text-text-muted hover:text-text-primary cursor-pointer p-0.5 rounded hover:bg-bg-surface transition-colors"
            onClick={goBack}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-xl font-bold tracking-tight">
            {editingProject ? "Edit Project" : "New Project"}
          </h2>
        </div>
        <p className="text-[13px] text-text-muted pl-7">
          {editingProject
            ? `Editing "${editingProject.name}"`
            : "Configure a new project to track issues for a repository."}
        </p>
        <button
          className="absolute top-4 right-4 bg-none border-none text-text-muted cursor-pointer p-1 rounded-md hover:text-text-primary hover:bg-bg-surface"
          onClick={onClose}
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <nav className="w-44 shrink-0 border-r border-border py-4 px-2 flex flex-col gap-1 overflow-y-auto">
          <p className="px-2 py-1.5 text-[13px] font-semibold text-text-primary">Shared</p>
          {SHARED_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => selectSection(s.id)}
              className={`w-full pl-5 pr-2 py-1.5 text-[12px] rounded-md text-left cursor-pointer transition-colors ${
                activeSection === s.id && activeGroup === "shared"
                  ? "text-text-primary bg-bg-surface font-medium"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-surface"
              }`}
            >
              {s.label}
            </button>
          ))}
          {editingProject && (
            <>
              <p className="px-2 py-1.5 mt-2 text-[13px] font-semibold text-text-primary">Personal</p>
              {PERSONAL_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSection(s.id)}
                  className={`w-full pl-5 pr-2 py-1.5 text-[12px] rounded-md text-left cursor-pointer transition-colors ${
                    activeSection === s.id && activeGroup === "personal"
                      ? "text-text-primary bg-bg-surface font-medium"
                      : "text-text-muted hover:text-text-primary hover:bg-bg-surface"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </>
          )}
        </nav>

        {/* Right panel */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          {/* Section tabs */}
          <div className="flex border-b border-border px-5 gap-1 overflow-x-auto shrink-0">
            {activeSections.map((s) => {
              const dirty =
                activeGroup === "shared"
                  ? isSectionDirty(s.id, sharedDirtyFields)
                  : isSectionDirty(s.id, userDirtyFields);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`px-3 py-2.5 text-[12px] font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                    activeSection === s.id
                      ? "border-primary text-primary"
                      : "border-transparent text-text-muted hover:text-text-primary"
                  }`}
                  onClick={() => setActiveSection(s.id)}
                >
                  {s.label}
                  {dirty && <span className="ml-0.5 text-primary">*</span>}
                </button>
              );
            })}
          </div>

          {/* Section content */}
          <div className="flex-1 overflow-y-auto">
          <div className="p-5 max-w-2xl">
            <FormProvider {...sharedForm}>
              {activeSection === "general" && (
                <GeneralSection editingProject={editingProject} isAdminOrOwner={isAdminOrOwner} onEditWorkflow={onEditWorkflow} />
              )}
              {activeSection === "integration" && (
                <IntegrationSection editingProject={editingProject} isAdminOrOwner={isAdminOrOwner} />
              )}
              {activeSection === "build" && <BuildSection projectId={editingProject?.project_id} showBuild={showingBuild} onBuildDone={() => setShowingBuild(false)} />}
              {activeSection === "security" && <SecuritySection />}
              {activeSection === "advanced" && <AdvancedSection projectRoot={projectRoot} />}
            </FormProvider>
            <FormProvider {...userForm}>
              {activeSection === "paths" && <PathsSection />}
              {activeSection === "container" && <ContainerSection />}
            </FormProvider>
            {activeSection === "ai_settings" && editingProject && (
              <AISettingsSection projectId={editingProject.project_id} />
            )}
          </div>
          </div>

          {/* Footer */}
          <div className="p-5 pt-4 border-t border-border shrink-0">
            <div className="flex justify-end gap-2">
              {activeGroup === "personal" && editingProject && activeSection !== "ai_settings" ? (
                <button
                  disabled={isPending}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium bg-primary text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  onClick={() => userForm.handleSubmit(onUserSubmit)()}
                >
                  {isPending ? "Saving..." : "Save My Settings"}
                </button>
              ) : activeGroup === "shared" && isAdminOrOwner ? (
                <button
                  disabled={isPending || !sharedName}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium bg-primary text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  onClick={() => sharedForm.handleSubmit(onSharedSubmit)()}
                >
                  {isPending ? "Saving..." : editingProject ? "Save Changes" : "Create Project"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
