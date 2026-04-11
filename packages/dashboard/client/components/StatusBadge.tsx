import { statusLabel } from "../lib/format";

const BADGE_COLORS: Record<string, string> = {
  starting: "bg-primary-subtle text-primary",
  running: "bg-primary-subtle text-primary",
  step_done: "bg-ok-bg text-ok",
  stopped: "bg-warn-bg text-warn",
  failed: "bg-err-bg text-err",
  cleaned_up: "bg-text-faint/10 text-text-faint",
  queued: "bg-text-faint/15 text-text-muted",
  completed: "bg-ok-bg text-ok",
};

export function StatusBadge({ status }: { status: string }) {
  const colors = BADGE_COLORS[status] || "bg-muted/15 text-muted";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide shrink-0 ${colors}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full bg-current ${
          status === "running" || status === "starting" ? "animate-[pulse_1.5s_infinite]" : ""
        }`}
      />
      {statusLabel(status)}
    </span>
  );
}
