import type { ResourceMetrics } from "@ysa-ai/shared";

interface ResourceBarProps {
  metrics: ResourceMetrics | null;
  stale: boolean;
}

function barColor(pct: number): string {
  if (pct >= 85) return "bg-err";
  if (pct >= 75) return "bg-warn";
  return "bg-primary";
}

function pctColor(pct: number): string {
  if (pct >= 85) return "text-err";
  if (pct >= 75) return "text-warn";
  return "text-text-secondary";
}

export function ResourceBar({ metrics, stale }: ResourceBarProps) {
  if (!metrics) {
    return <span className="text-[11px] text-text-faint">No resource data</span>;
  }

  const { host, aggregate, capacity } = metrics;
  const memWarn = metrics.warnings.includes("memory_high");
  const diskWarn = metrics.warnings.includes("disk_low");

  return (
    <div className={`relative flex gap-4 ${stale ? "opacity-40" : ""}`}>
      {host.mem_source === "vm" && (
        <span
          className="absolute top-0 -right-3 text-[12px] text-primary border border-primary/40 px-2 py-0.5 rounded-bl font-mono font-bold cursor-default"
          title={host.mem_source === "vm" ? "Memory reported by the Podman VM — this is the actual limit for containers" : "Memory reported by the host — may not reflect container limits"}
        >{host.mem_source === "vm" ? "VM" : "HOST"}</span>
      )}
      <div className="flex-[2] space-y-1.5 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted w-7 shrink-0">CPU</span>
          <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
            <div className={`h-full ${barColor(host.cpu_pct)} rounded-full transition-all`} style={{ width: `${Math.min(host.cpu_pct, 100)}%` }} />
          </div>
          <span className={`text-[11px] font-mono tabular-nums w-9 text-right font-medium ${pctColor(host.cpu_pct)}`}>{host.cpu_pct}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted w-7 shrink-0">MEM</span>
          <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
            <div className={`h-full ${barColor(host.mem_pct)} rounded-full transition-all`} style={{ width: `${Math.min(host.mem_pct, 100)}%` }} />
          </div>
          <span className={`text-[11px] font-mono tabular-nums w-9 text-right font-medium ${pctColor(host.mem_pct)}`}>{host.mem_pct}%</span>
        </div>
        <div className="flex items-start gap-4 pt-1">
          <div>
            <span className="text-[10px] text-text-muted uppercase tracking-wide">Containers</span>
            <p className="font-mono font-bold text-[13px] text-text-primary tabular-nums leading-tight">{aggregate.count}</p>
          </div>
          <div>
            <span className="text-[10px] text-text-muted uppercase tracking-wide">Disk free</span>
            <p className={`font-mono font-bold text-[13px] tabular-nums leading-tight ${diskWarn ? "text-err" : "text-text-primary"}`}>{host.disk_free_gb} GB</p>
          </div>
          {(stale || memWarn) && (
            <div className="ml-auto flex items-center gap-1.5 pt-1">
              {stale && <span className="text-text-faint text-[10px] italic">stale</span>}
              {memWarn && <span className="text-err font-bold text-[10px]">mem!</span>}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 border-l border-border-subtle pl-4 flex flex-col justify-center gap-1.5">
        <div>
          <span className="text-[10px] text-text-muted uppercase tracking-wide">Capacity</span>
          <p className="font-mono font-bold text-[18px] text-primary tabular-nums leading-tight">{capacity?.estimated_remaining != null ? `+${capacity.estimated_remaining}` : "—"}</p>
        </div>
        <div>
          <span className="text-[10px] text-text-muted uppercase tracking-wide">Avg size</span>
          <p className="font-mono font-bold text-[18px] text-text-primary tabular-nums leading-tight">{capacity?.avg_peak_mb != null ? `${capacity.avg_peak_mb} MB` : "— MB"}</p>
        </div>
      </div>
    </div>
  );
}
