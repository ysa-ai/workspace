import { useState } from "react";
import type { DetectedConfig } from "./index";

export const INPUT = "w-full bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all";
export const INPUT_MONO = `${INPUT} font-mono`;

export function WizardField({
  label,
  hint,
  required,
  confidence,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  confidence?: "high" | "medium" | "low";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-[13px] font-semibold text-text-primary">
          {label}
          {required && <span className="text-err ml-0.5">*</span>}
        </label>
        {confidence === "low" && (
          <span className="text-[10px] px-1.5 py-px rounded bg-warn/10 text-warn border border-warn/20 font-medium">guessed</span>
        )}
        {confidence === "medium" && (
          <span className="text-[10px] px-1.5 py-px rounded bg-primary/8 text-primary/70 border border-primary/15 font-medium">inferred</span>
        )}
      </div>
      {children}
      {hint && <p className="text-[11px] text-text-faint mt-1">{hint}</p>}
    </div>
  );
}

export function AdvancedSection({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
      >
        <svg
          width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Advanced
      </button>
      {open && <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}

export function StepFooter({
  onBack,
  onSkip,
  onNext,
  nextLabel,
  nextDisabled,
  isPending,
  isFirst,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  isPending?: boolean;
  isFirst?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-6 border-t border-border mt-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>
      <div className="flex items-center gap-2">
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2 text-[13px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            Skip for now
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || isPending}
          className="px-4 py-2 rounded-lg text-[13px] font-medium bg-primary text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          {isPending ? "Saving…" : (nextLabel ?? "Next")}
        </button>
      </div>
    </div>
  );
}

export function confidence(detected: DetectedConfig | null, field: keyof DetectedConfig): "high" | "medium" | "low" | undefined {
  if (!detected?.confidence) return undefined;
  return detected.confidence[field as string] as "high" | "medium" | "low" | undefined;
}
