import { useState, useEffect } from "react";
import { trpc } from "../../trpc";
import { useToast } from "../Toast";
import { useAuth } from "../../AuthProvider";
import { WorkflowBuilder } from "../WorkflowBuilder";
import { ProjectList } from "./ProjectList";
import { ProjectForm } from "./ProjectForm";
import { ProjectCreationWizard } from "../ProjectCreationWizard";
import { PERSONAL_SECTION_IDS } from "./types";
import type { Project, ProjectSettingsPanelProps } from "./types";

type View = "list" | "form" | "wizard" | "workflow_builder";

export function ProjectSettingsPanel({
  onClose,
  onSwitchProject,
  initialSection,
  initialWorkflowBuilderTarget,
  startInCreateMode,
  onNavigateWorkflow,
  onCloseWorkflow,
}: ProjectSettingsPanelProps) {
  const resolvedInitialSection = initialSection === "mysettings" ? "paths" : initialSection ?? "general";

  const [view, setView] = useState<View>(
    initialWorkflowBuilderTarget !== undefined ? "workflow_builder" : startInCreateMode ? "wizard" : "list",
  );
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [workflowBuilderTarget, setWorkflowBuilderTarget] = useState<number | null | undefined>(
    initialWorkflowBuilderTarget !== undefined ? initialWorkflowBuilderTarget : undefined,
  );
  // formResetCount forces a fresh ProjectForm mount when switching between edits
  const [formResetCount, setFormResetCount] = useState(0);

  const showToast = useToast();
  const utils = trpc.useUtils();
  const { user, orgs } = useAuth();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (user && !user.onboardingCompletedAt && user.onboardingStep >= 2) return;
      e.preventDefault();
      if (view === "workflow_builder") {
        setWorkflowBuilderTarget(undefined);
        setView("form");
        onCloseWorkflow?.();
      } else if (view === "form" || view === "wizard") {
        setView("list");
      } else {
        onClose();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [view, user, onClose, onCloseWorkflow]);
  const myRole = orgs.find((o) => o.id === user?.orgId)?.role ?? "member";
  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  const { data: projectsList = [] } = trpc.projects.list.useQuery();

  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      showToast("Project deleted", "success");
      utils.projects.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const setDefaultMutation = trpc.projects.setDefault.useMutation({
    onSuccess: () => {
      showToast("Default project updated", "success");
      utils.projects.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const openForm = (project?: Project) => {
    setEditingProject(project ?? null);
    setFormResetCount((c) => c + 1);
    setView(project ? "form" : "wizard");
  };

  // initialSection for ProjectForm: use resolvedInitialSection only on first mount
  const formInitialSection = formResetCount === 0 ? resolvedInitialSection : "general";

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-raised">
      {view === "workflow_builder" && workflowBuilderTarget !== undefined ? (
        <WorkflowBuilder
          workflowId={workflowBuilderTarget}
          onSaved={() => {
            setWorkflowBuilderTarget(undefined);
            onCloseWorkflow?.();
          }}
          onClose={() => {
            setWorkflowBuilderTarget(undefined);
            setView("form");
            onCloseWorkflow?.();
          }}
        />
      ) : view === "wizard" ? (
        <ProjectCreationWizard
          onClose={onClose}
          onSwitchProject={onSwitchProject}
          onBack={() => setView("list")}
        />
      ) : view === "list" ? (
        <ProjectList
          projects={projectsList}
          isAdminOrOwner={isAdminOrOwner}
          onEdit={openForm}
          onCreate={() => openForm()}
          onDelete={(p) => deleteMutation.mutate({ projectId: p.project_id })}
          onSetDefault={(p) => setDefaultMutation.mutate({ projectId: p.project_id })}
          onSelect={(p) => {
            onSwitchProject?.(p.project_id);
            onClose();
          }}
          onClose={onClose}
        />
      ) : (
        <ProjectForm
          key={formResetCount === 0 ? "initial" : `edit-${formResetCount}`}
          editingProject={editingProject}
          isAdminOrOwner={isAdminOrOwner}
          initialSection={formInitialSection}
          onBack={() => setView("list")}
          onClose={onClose}
          onSwitchProject={onSwitchProject}
          onEditWorkflow={(id) => { setWorkflowBuilderTarget(id); setView("workflow_builder"); }}
        />
      )}
    </div>
  );
}
