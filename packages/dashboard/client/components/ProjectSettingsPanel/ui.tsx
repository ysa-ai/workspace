export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[13px] font-semibold mb-1.5">
        {label}
        {required && <span className="text-err ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-text-faint mt-1">{hint}</p>}
    </div>
  );
}

export function BrowseBtn({
  onClick,
  loading,
  disabled,
}: {
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? "…" : "Browse"}
    </button>
  );
}
