import { useState } from "react";
import type { Project } from "./types";

function SmallBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      className={`p-1.5 rounded-md cursor-pointer transition-colors ${
        danger
          ? "text-text-faint hover:text-err hover:bg-err-bg"
          : "text-text-faint hover:text-text-primary hover:bg-bg-surface"
      }`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

export function ProjectList({
  projects,
  isAdminOrOwner,
  onEdit,
  onCreate,
  onDelete,
  onSetDefault,
  onSelect,
  onClose,
}: {
  projects: Project[];
  isAdminOrOwner: boolean;
  onEdit: (p: Project) => void;
  onCreate: () => void;
  onDelete: (p: Project) => void;
  onSetDefault: (p: Project) => void;
  onSelect: (p: Project) => void;
  onClose: () => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <>
      <div className="p-5 pb-4 border-b border-border">
        <div className="flex items-center gap-2 mb-1.5">
          <button
            className="text-text-muted hover:text-text-primary cursor-pointer p-0.5 rounded hover:bg-bg-surface transition-colors"
            onClick={onClose}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-xl font-bold tracking-tight">Manage Projects</h2>
        </div>
        <p className="text-[13px] text-text-muted pl-7">
          {projects.length} project{projects.length !== 1 ? "s" : ""} configured
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-5 max-w-2xl space-y-2">
          {projects.map((p) => (
            <div
              key={p.project_id}
              className="px-4 py-3 rounded-lg border border-border bg-bg-inset hover:border-border-bright hover:bg-bg-surface transition-all cursor-pointer"
              onClick={() => onEdit(p)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[14px] font-semibold truncate">{p.name}</span>
                  {p.is_default && (
                    <span className="text-[10px] text-primary bg-primary-subtle px-1.5 py-0.5 rounded-full shrink-0 font-medium">
                      default
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isAdminOrOwner && (
                    <SmallBtn onClick={(e) => { e.stopPropagation(); onEdit(p); }} title="Edit">
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </SmallBtn>
                  )}
                  {isAdminOrOwner && !p.is_default && (
                    <>
                      <SmallBtn onClick={(e) => { e.stopPropagation(); onSetDefault(p); }} title="Set as default">
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      </SmallBtn>
                      {confirmDeleteId === p.project_id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[11px] text-err mr-1">Delete?</span>
                          <button
                            className="px-2 py-1 rounded text-[11px] font-medium bg-err text-white hover:brightness-110 cursor-pointer transition-colors"
                            onClick={() => { setConfirmDeleteId(null); onDelete(p); }}
                          >
                            Yes
                          </button>
                          <button
                            className="px-2 py-1 rounded text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-surface cursor-pointer transition-colors"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <SmallBtn onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.project_id); }} title="Delete" danger>
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </SmallBtn>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-text-muted">
                <span className="font-medium">{p.issue_source === "github" ? "GitHub" : "GitLab"}</span>
                <span>branch: {p.branch_prefix}*</span>
                <span>{p.network_policy === "strict" ? "restricted" : "full internet"}</span>
                <span>{p.container_memory} / {p.container_cpus}cpu</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-5 pt-4 border-t border-border flex justify-end">
        <button
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-primary text-white hover:brightness-110 cursor-pointer transition-colors"
          onClick={onCreate}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14m-7-7h14" />
          </svg>
          New Project
        </button>
      </div>
    </>
  );
}
