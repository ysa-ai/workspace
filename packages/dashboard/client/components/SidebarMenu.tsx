import { useState, useRef, useEffect } from "react";
import { useAuth } from "../AuthProvider";
import { useNavigate } from "react-router";
import { resetIdentity } from "../lib/analytics";


interface Props {
  projectId: string | undefined;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenOrgSettings: () => void;
  onboarding?: boolean;
}

export function SidebarMenu({ projectId, theme, onToggleTheme, onOpenOrgSettings, onboarding }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function handleProjectSettings() {
    setOpen(false);
    navigate(projectId ? `/${projectId}/settings` : "/settings");
  }

  function handleOrgSettings() {
    setOpen(false);
    onOpenOrgSettings();
  }

  function handleSignOut() {
    setOpen(false);
    resetIdentity();
    logout();
    navigate("/signin");
  }

  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <div ref={ref} className="relative flex items-center gap-2 shrink-0">
      {/* Menu button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`p-1.5 rounded transition-colors cursor-pointer ${open ? "bg-bg-surface text-text-primary" : "text-text-faint hover:text-text-primary hover:bg-bg-surface"}`}
        title="Menu"
      >
        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Avatar */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 cursor-pointer hover:bg-primary/30 transition-colors"
      >
        <span className="text-[10px] font-bold text-primary leading-none">{initial}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-60 bg-bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden py-2">

          {!onboarding && <>
          {/* Project settings */}
          <button
            onClick={handleProjectSettings}
            className="flex items-center w-full px-3 py-2 text-left hover:bg-bg-inset transition-colors cursor-pointer"
          >
            <span className="text-[14px] text-text-primary">Project settings</span>
          </button>

          <div className="my-2 border-t border-border" />

          {/* Organization */}
          <button
            onClick={handleOrgSettings}
            className="flex items-center w-full px-3 py-2 text-left hover:bg-bg-inset transition-colors cursor-pointer"
          >
            <span className="text-[14px] text-text-primary">Organization settings</span>
          </button>

          <div className="my-2 border-t border-border" />
          </>}

          {/* Theme toggle */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[14px] text-text-primary">{theme === "dark" ? "Dark mode" : "Light mode"}</span>
            <button
              onClick={onToggleTheme}
              className={`relative w-10 h-5.5 rounded-full transition-colors duration-200 cursor-pointer ${theme === "light" ? "bg-primary" : "bg-border"}`}
            >
              <div className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all duration-200 ${theme === "light" ? "left-[20px]" : "left-[3px]"}`} />
            </button>
          </div>

          <div className="my-2 border-t border-border" />

          {/* My Account */}
          <button
            onClick={() => { setOpen(false); navigate("/account/settings"); }}
            className="flex items-center w-full px-3 py-2 text-left hover:bg-bg-inset transition-colors cursor-pointer"
          >
            <span className="text-[14px] text-text-primary">My account</span>
          </button>

          {/* Report a bug */}
          <a
            href="https://github.com/ysa-ai/workspace/issues"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center w-full px-3 py-2 text-left hover:bg-bg-inset transition-colors cursor-pointer"
          >
            <span className="text-[14px] text-text-primary">Report a bug</span>
          </a>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="flex items-center w-full px-3 py-2 text-left hover:bg-bg-inset transition-colors cursor-pointer"
          >
            <span className="text-[14px] text-text-primary">Sign out</span>
          </button>
        </div>
      )}

    </div>
  );
}
