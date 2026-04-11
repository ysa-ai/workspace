import { useState, useRef, useEffect } from "react";
import { useAuth } from "../AuthProvider";
import { useNavigate } from "react-router";

export function OrgSwitcher() {
  const { user, orgs, switchOrg, createOrg } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setError("");
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleSwitch(orgId: number) {
    if (orgId === user?.orgId) { setOpen(false); return; }
    setLoading(true);
    try {
      await switchOrg(orgId);
      localStorage.removeItem("dashboard_active_project");
      window.location.href = "/";
    } catch {
      setLoading(false);
      setOpen(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setLoading(true);
    setError("");
    try {
      await createOrg(newOrgName.trim());
      localStorage.removeItem("dashboard_active_project");
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message ?? "Failed to create organization");
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        onClick={() => { setOpen((o) => !o); setCreating(false); setError(""); }}
        className="flex items-center gap-1.5 min-w-0 max-w-full px-2 py-1 rounded hover:bg-bg-surface transition-colors cursor-pointer group"
      >
        <span className="text-[14px] font-semibold tracking-tight truncate text-text-primary">
          {user?.orgName ?? "…"}
        </span>
        <svg
          width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          className={`shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold text-text-faint uppercase tracking-widest">Organizations</p>
          </div>

          <div className="max-h-48 overflow-y-auto">
            {orgs.map((org) => (
              <button
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                disabled={loading}
                className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-bg-inset transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="flex-1 text-[13px] text-text-primary truncate">{org.name}</span>
                {org.id === user?.orgId && (
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="shrink-0 text-primary">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-border">
            {creating ? (
              <form onSubmit={handleCreate} className="px-3 py-2 flex flex-col gap-2">
                {error && <p className="text-[11px] text-err">{error}</p>}
                <input
                  autoFocus
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Organization name"
                  className="w-full px-2 py-1.5 bg-bg-inset border border-border rounded text-[12px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-primary transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={loading || !newOrgName.trim()}
                    className="flex-1 py-1 bg-primary-subtle border border-primary/30 rounded text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCreating(false); setError(""); }}
                    className="px-2 py-1 text-[11px] text-text-faint hover:text-text-primary transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-bg-inset transition-colors cursor-pointer"
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-text-faint shrink-0">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
                <span className="text-[12px] text-text-muted">New organization</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
