import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc";
import type { DetectedConfig } from "./index";

export function AutoDetectLoader({
  taskId,
  onDetected,
  onFailed,
  onClose,
}: {
  taskId: string;
  onDetected: (config: DetectedConfig) => void;
  onFailed: () => void;
  onClose: () => void;
}) {
  const calledRef = useRef(false);
  const [timedOut, setTimedOut] = useState(false);

  const { data: task } = trpc.tasks.get.useQuery(
    { id: taskId },
    {
      refetchInterval: (query) => {
        const s = (query.state.data as any)?.status;
        if (s === "done" || s === "failed" || s === "stopped") return false;
        return 2000;
      },
      enabled: !!taskId,
    },
  );

  const resultQuery = trpc.tasks.result.useQuery(
    { id: taskId },
    {
      enabled: (task as any)?.status === "done",
      retry: 3,
    },
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!calledRef.current) {
        calledRef.current = true;
        setTimedOut(true);
        onFailed();
      }
    }, 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (calledRef.current) return;
    const status = (task as any)?.status;

    if (status === "done" && resultQuery.data) {
      calledRef.current = true;
      onDetected(resultQuery.data as DetectedConfig);
    } else if (status === "failed" || status === "stopped") {
      calledRef.current = true;
      onFailed();
    }
  }, [(task as any)?.status, resultQuery.data]);

  const status = (task as any)?.status ?? "starting";
  const phase = (task as any)?.step ?? "";
  const isRunning = status === "running" || status === "starting";

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-raised">
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Detecting project configuration</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
        <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${isRunning ? "border-primary/30 border-t-primary animate-spin" : status === "done" ? "border-ok bg-ok/10" : "border-err bg-err/10"}`}>
          {!isRunning && (
            status === "done" ? (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="text-ok">
                <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="text-err">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )
          )}
        </div>

        <div className="text-center space-y-1.5">
          <p className="text-[14px] font-semibold text-text-primary">
            {isRunning ? "Analyzing project…" : status === "done" ? "Detection complete" : "Detection failed"}
          </p>
          <p className="text-[13px] text-text-muted">
            {isRunning
              ? "Usually under a minute · Reading project files, package manifests, CI config, and scripts"
              : status === "done"
              ? "Settings pre-filled from your project"
              : "Could not detect configuration — you can configure manually"}
          </p>
        </div>

        {isRunning && (
          <div className="w-full max-w-xs space-y-2">
            {["Reading project files", "Detecting language runtimes", "Analyzing build configuration", "Detecting dev servers"].map((label, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] text-text-muted">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                {label}
              </div>
            ))}
          </div>
        )}

        {status === "failed" && (
          <button
            type="button"
            onClick={onFailed}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-bg-surface border border-border hover:border-border-bright transition-colors cursor-pointer"
          >
            Continue manually
          </button>
        )}
      </div>
    </div>
  );
}
