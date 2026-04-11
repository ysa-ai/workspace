import { statusLabel } from "../lib/format";

const CHIP_ACTIVE_COLORS: Record<string, string> = {
  starting: "text-primary border-border",
  running: "text-primary border-border",
  step_done: "text-ok border-border",
  stopped: "text-warn border-border",
  failed: "text-err border-border",
  cleaned_up: "text-text-secondary border-border",
};

interface StatusFilterProps {
  statuses: { status: string; count: number }[];
  hiddenStatuses: Set<string>;
  onToggle: (status: string) => void;
}

export function StatusFilter({ statuses, hiddenStatuses, onToggle }: StatusFilterProps) {
  if (statuses.length === 0) return null;

  return (
    <div className="flex gap-1.5 flex-wrap">
      {statuses.map(({ status, count }) => {
        const active = !hiddenStatuses.has(status);
        return (
          <button
            key={status}
            onClick={() => onToggle(status)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide border cursor-pointer transition-all ${
              active
                ? CHIP_ACTIVE_COLORS[status] || "text-muted border-muted/20 bg-muted/8"
                : "text-text-muted border-border-subtle bg-transparent hover:text-text-secondary hover:border-border"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {statusLabel(status)}
            <span className="font-bold tabular-nums">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
