import { useState } from "react";
import { useAuth } from "../AuthProvider";
import { trpc } from "../trpc";
import { useToast } from "./Toast";
import { OrgMembersSection } from "./OrgMembersSection";
import { WorkflowsSection } from "./ProjectSettingsPanel/sections/shared/WorkflowsSection";
import { WorkflowBuilder } from "./WorkflowBuilder";

interface Props {
  onClose: () => void;
}

const NAV_ITEMS = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "workflows", label: "Workflows" },
];

export function OrgSettingsPanel({ onClose }: Props) {
  const { user, orgs, deleteOrg } = useAuth();
  const showToast = useToast();
  const utils = trpc.useUtils();

  const currentOrg = orgs.find((o) => o.id === user?.orgId);
  const isOwner = currentOrg?.role === "owner";

  const [activeSection, setActiveSection] = useState("general");
  // undefined = closed, null = new workflow, number = edit existing
  const [workflowBuilderTarget, setWorkflowBuilderTarget] = useState<number | null | undefined>(undefined);
  const [name, setName] = useState(currentOrg?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm">("idle");
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const updateOrgMutation = trpc.auth.updateOrg.useMutation({
    onSuccess: async () => {
      await utils.auth.orgs.invalidate();
      await utils.auth.me.invalidate();
      showToast("Organization updated", "success");
      setSaving(false);
    },
    onError: (err) => { showToast(err.message, "error"); setSaving(false); },
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.orgId || !name.trim()) return;
    setSaving(true);
    updateOrgMutation.mutate({ orgId: user.orgId, name: name.trim() });
  }

  async function handleDelete() {
    if (!user?.orgId || deleteInput !== currentOrg?.name) return;
    setDeleting(true);
    try {
      await deleteOrg(user.orgId);
      localStorage.removeItem("dashboard_active_project");
      window.location.href = "/";
    } catch (err: any) {
      showToast(err.message ?? "Failed to delete organization", "error");
      setDeleting(false);
    }
  }

  if (workflowBuilderTarget !== undefined) {
    return (
      <WorkflowBuilder
        workflowId={workflowBuilderTarget}
        onSaved={() => setWorkflowBuilderTarget(undefined)}
        onClose={() => setWorkflowBuilderTarget(undefined)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-raised">
      <div className="shrink-0 flex items-center gap-3 px-6 h-14 border-b border-border">
        <button
          onClick={onClose}
          className="p-1.5 rounded text-text-faint hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 className="text-[14px] font-semibold text-text-primary">Organization settings</h2>
      </div>

      <div className="flex flex-1 min-h-0">
        <nav className="w-44 shrink-0 border-r border-border py-4 px-2 flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`px-2 py-1.5 text-[12px] font-medium rounded-md text-left cursor-pointer transition-colors ${
                activeSection === item.id
                  ? "text-text-primary bg-bg-surface"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-surface"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          <div className="px-8 py-8 max-w-2xl">
          {activeSection === "members" ? (
            <OrgMembersSection
              currentUserId={user?.id ?? 0}
              currentUserRole={currentOrg?.role ?? "member"}
            />
          ) : activeSection === "workflows" ? (
            <WorkflowsSection
              projectId={null}
              currentWorkflowId={null}
              isAdminOrOwner={isOwner}
              onEdit={(id) => setWorkflowBuilderTarget(id)}
              onNew={() => setWorkflowBuilderTarget(null)}
            />
          ) : (
            <>
              <section className="mb-10">
                <h3 className="text-[13px] font-semibold text-text-primary mb-4">Organization name</h3>
                <form onSubmit={handleSave} className="flex items-end gap-3">
                  <div className="flex-1">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={!isOwner}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-primary transition-colors disabled:opacity-60"
                    />
                  </div>
                  {isOwner && (
                    <button
                      type="submit"
                      disabled={saving || !name.trim() || name.trim() === currentOrg?.name}
                      className="px-4 py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[12px] font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  )}
                </form>
                {!isOwner && (
                  <p className="mt-2 text-[11px] text-text-faint">Only the owner can modify organization settings.</p>
                )}
              </section>

              {isOwner && (
                <section className="border border-err/40 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-err/20 bg-err/5">
                    <h3 className="text-[13px] font-semibold text-err">Danger Zone</h3>
                  </div>
                  <div className="px-5 py-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[13px] font-medium text-text-primary mb-1">Delete this organization</p>
                        <p className="text-[12px] text-text-muted leading-relaxed">
                          Permanently deletes all projects, issues, workflows, and data associated with{" "}
                          <span className="font-medium text-text-primary">{currentOrg?.name}</span>.
                          This action cannot be undone.
                        </p>
                      </div>
                      {deleteStep === "idle" && (
                        <button
                          onClick={() => setDeleteStep("confirm")}
                          className="shrink-0 px-3.5 py-1.5 rounded-lg border border-err/50 text-[12px] font-medium text-err hover:bg-err/10 transition-colors cursor-pointer"
                        >
                          Delete organization
                        </button>
                      )}
                    </div>
                    {deleteStep === "confirm" && (
                      <div className="mt-5 pt-5 border-t border-border">
                        <p className="text-[12px] text-text-muted mb-3">
                          To confirm, type <span className="font-semibold text-text-primary font-mono">{currentOrg?.name}</span> below:
                        </p>
                        <input
                          autoFocus
                          value={deleteInput}
                          onChange={(e) => setDeleteInput(e.target.value)}
                          placeholder={currentOrg?.name}
                          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-err transition-colors mb-3 font-mono"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleDelete}
                            disabled={deleting || deleteInput !== currentOrg?.name}
                            className="px-4 py-2 bg-err text-white rounded-lg text-[12px] font-semibold hover:bg-err/80 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {deleting ? "Deleting…" : "I understand, delete this organization"}
                          </button>
                          <button
                            onClick={() => { setDeleteStep("idle"); setDeleteInput(""); }}
                            className="px-4 py-2 rounded-lg border border-border text-[12px] text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
