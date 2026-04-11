import { formatDuration, useLiveTick } from "../lib/format";


interface WorkflowStepInfo {
  id?: number;
  slug: string;
  name: string;
  position?: number;
}

interface PhaseTimings {
  [phase: string]: { started_at?: string; finished_at?: string };
}

function parseTimings(raw?: string | null): PhaseTimings {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function isStepCompleted(
  stepSlug: string,
  currentSlug: string,
  steps: WorkflowStepInfo[],
  isDone: boolean,
): boolean {
  if (isDone) return true;
  const currentIdx = steps.findIndex((s) => s.slug === currentSlug);
  const stepIdx = steps.findIndex((s) => s.slug === stepSlug);
  return stepIdx < currentIdx;
}

// ─── Compact dots — used in IssueRow ──────────────────────────────────────

export function Stepper({
  phase,
  status,
  workflowSteps,
}: {
  phase: string;
  status: string;
  workflowSteps?: WorkflowStepInfo[];
}) {
  const steps = workflowSteps ?? [];
  const currentSlug = phase;
  const isDone = status === "finalized" || status === "cleaned_up";
  const isRunning = status === "running" || status === "starting";

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const completed = isStepCompleted(step.slug, currentSlug, steps, isDone);
        const current = step.slug === currentSlug;
        return (
          <div key={step.slug} className="flex items-center gap-1">
            {i > 0 && (
              <span
                className={`w-4 h-0.5 transition-colors duration-300 ${
                  completed || current ? "bg-ok" : "bg-border"
                }`}
              />
            )}
            <span
              className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                completed
                  ? "bg-ok"
                  : current && isRunning
                    ? "bg-primary animate-[pulse_1.5s_infinite]"
                    : current
                      ? "bg-primary"
                      : "bg-border"
              }`}
              title={step.name}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Full phase stepper — used in IssueDetail header ──────────────────────

interface PhaseStepperProps {
  phase: string;
  status: string;
  phaseTimingsRaw?: string | null;
  availableLogs?: string[];
  selectedPhase: string;
  onSelectPhase: (p: string) => void;
  workflowSteps?: WorkflowStepInfo[];
}

export function PhaseStepper({
  phase,
  status,
  phaseTimingsRaw,
  availableLogs,
  selectedPhase,
  onSelectPhase,
  workflowSteps,
}: PhaseStepperProps) {
  const steps = workflowSteps ?? [];
  const currentSlug = phase;
  const isDone = status === "finalized" || status === "cleaned_up";
  const isRunning = status === "running" || status === "starting";
  const timings = parseTimings(phaseTimingsRaw);

  useLiveTick(isRunning);

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const isCompleted = isStepCompleted(step.slug, currentSlug, steps, isDone);
        const isCurrent = step.slug === currentSlug;
        const isLive = isCurrent && isRunning;
        const isSelected = step.slug === selectedPhase;
        const isClickable = isCompleted || isCurrent;
        void availableLogs;

        const t = timings[step.slug];
        let durationStr = "";
        if (t?.started_at && t?.finished_at) {
          durationStr = formatDuration(t.started_at, t.finished_at);
        } else if (t?.started_at && isCurrent) {
          durationStr = formatDuration(t.started_at, null);
        }

        // Connector line
        const connector =
          i > 0 ? (
            <div
              className={`w-5 h-px shrink-0 mx-0.5 transition-colors ${
                isCompleted || isCurrent ? "bg-ok/50" : "bg-border"
              }`}
            />
          ) : null;

        // Status icon
        let icon: React.ReactNode;
        if (isCompleted) {
          icon = (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-ok shrink-0">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          );
        } else if (isLive) {
          icon = (
            <span className="w-2.25 h-2.25 rounded-full bg-primary animate-[pulse_1.5s_infinite] shrink-0" />
          );
        } else if (isCurrent) {
          icon = <span className="w-2.25 h-2.25 rounded-full bg-primary shrink-0" />;
        } else {
          icon = (
            <span className="w-2.25 h-2.25 rounded-full border border-border-bright shrink-0" />
          );
        }

        return (
          <div key={step.slug} className="flex items-center">
            {connector}
            <button
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all
                ${isClickable ? "cursor-pointer" : "cursor-default"}
                ${
                  isSelected && isCompleted
                    ? "bg-ok/8 border-ok/30 shadow-sm"
                    : isSelected && isCurrent
                      ? "bg-primary/8 border-primary/30 shadow-sm"
                      : isCompleted
                        ? "border-ok/20 hover:bg-ok/5 hover:border-ok/30"
                        : isCurrent
                          ? "border-primary/25 hover:bg-primary/5"
                          : "border-transparent"
                }
              `}
              onClick={() => isClickable && onSelectPhase(step.slug)}
              disabled={!isClickable}
            >
              {icon}
              <span
                className={`text-[12px] font-medium transition-colors ${
                  isCompleted
                    ? "text-ok"
                    : isCurrent
                      ? "text-text-primary"
                      : "text-text-faint"
                }`}
              >
                {step.name}
              </span>
              {durationStr && (
                <span className={`text-[10px] font-mono ${isCompleted ? "text-ok/70" : "text-text-faint"}`}>
                  {durationStr}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
