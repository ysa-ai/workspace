import { useEffect, useState } from "react";

export function useLiveTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

function parseTs(s: string): Date {
  // PostgreSQL returns timestamps without timezone (e.g. "2026-03-24 16:04:48").
  // Browsers parse those as local time — treat all timestamps as UTC.
  if (!s.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(s)) {
    s = s.replace(" ", "T") + "Z";
  }
  return new Date(s);
}

function fmtSeconds(diff: number): string {
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "";
  const t0 = parseTs(start);
  const t1 = end ? parseTs(end) : new Date();
  return fmtSeconds(Math.max(0, Math.floor((t1.getTime() - t0.getTime()) / 1000)));
}

// Sum elapsed_ms across all closed segments. For the last open segment, add live time if running.
export function formatActiveTime(
  phaseTimingsRaw: string | null | undefined,
  isRunning: boolean,
): string {
  if (!phaseTimingsRaw) return "";
  let timings: Record<string, { segments?: { started_at: string; elapsed_ms: number | null }[] }>;
  try { timings = JSON.parse(phaseTimingsRaw); } catch { return ""; }

  let totalMs = 0;
  for (const { segments = [] } of Object.values(timings)) {
    for (const seg of segments) {
      if (seg.elapsed_ms != null) {
        totalMs += seg.elapsed_ms;
      } else if (isRunning) {
        totalMs += Math.max(0, Date.now() - parseTs(seg.started_at).getTime());
      }
    }
  }

  const diff = Math.floor(totalMs / 1000);
  return diff > 0 ? fmtSeconds(diff) : "";
}

export function statusLabel(s: string): string {
  if (s === "cleaned_up") return "archived";
  return s.replace("_", " ");
}

const STATUS_ORDER = [
  "running",
  "starting",
  "step_done",
  "stopped",
  "failed",
  "cleaned_up",
];

const PROMPT_TASK_ID_OFFSET = 100_000_000;

export function displayTaskId(taskId: number, sourceType: string | null | undefined): string {
  if (sourceType === "prompt") return `#${taskId - PROMPT_TASK_ID_OFFSET}`;
  return `#${taskId}`;
}

export function statusSortOrder(s: string): number {
  const idx = STATUS_ORDER.indexOf(s);
  return idx === -1 ? STATUS_ORDER.length : idx;
}
