import { useState, useRef, useEffect } from "react";

interface Project {
  project_id: string;
  name: string;
  is_default: boolean;
}

interface ProjectSelectorProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  onManage: () => void;
}

export function ProjectSelector({ projects, activeProjectId, onSelect, onManage }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const active = projects.find((p) => p.project_id === activeProjectId) || projects.find((p) => p.is_default) || projects[0];

  if (projects.length === 0) return null;

  return (
    <div className="flex items-center gap-2" ref={ref}>
      <div className="relative flex-1">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium bg-bg-inset border border-border text-text-secondary hover:border-border-bright cursor-pointer transition-colors"
        onClick={() => setOpen(!open)}
      >
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-text-muted shrink-0">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="truncate flex-1 text-left">{active?.name || "Select Project"}</span>
        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className={`text-text-faint transition-transform shrink-0 ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-raised border border-border-bright rounded-lg shadow-lg overflow-hidden z-300">
          <div className="max-h-[240px] overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.project_id}
                className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 hover:bg-bg-surface cursor-pointer transition-colors ${
                  p.project_id === active?.project_id ? "text-primary font-medium" : "text-text-primary"
                }`}
                onClick={() => {
                  onSelect(p.project_id);
                  setOpen(false);
                }}
              >
                <span className="truncate flex-1">{p.name}</span>
                {p.is_default &&  (
                  <span className="text-[10px] text-text-faint bg-bg-surface px-1.5 py-0.5 rounded-full shrink-0">default</span>
                )}
                {p.project_id === active?.project_id && (
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="text-primary shrink-0">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      </div>
      <button
        className="shrink-0 self-stretch flex items-center justify-center px-2.5 rounded-lg border border-border bg-bg-inset text-text-muted hover:text-text-primary hover:border-border-bright transition-colors cursor-pointer"
        onClick={onManage}
        title="Project settings"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
    </div>
  );
}
