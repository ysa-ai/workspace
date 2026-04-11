import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "../trpc";

interface LogSectionProps {
  issueId: number;
  status: string;
  selectedPhase: string;
  onStoppableChange?: (stoppable: boolean) => void;
}

export function LogSection({ issueId, status, selectedPhase, onStoppableChange }: LogSectionProps) {
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [expandedNetwork, setExpandedNetwork] = useState<Set<number>>(new Set());
  const [entries, setEntries] = useState<any[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(0);
  const networkCursorRef = useRef(0);
  const utils = trpc.useUtils();

  const isRunning = status === "running" || status === "starting";

  useEffect(() => {
    setEntries([]);
    cursorRef.current = 0;
    networkCursorRef.current = 0;
    setExpandedTools(new Set());
    setExpandedNetwork(new Set());
    onStoppableChange?.(true);

    let cancelled = false;

    const fetchLogs = async () => {
      try {
        const data = await utils.tasks.log.fetch({
          id: String(issueId),
          step: selectedPhase || undefined,
          offset: cursorRef.current,
          networkOffset: networkCursorRef.current,
        });
        if (cancelled) return;
        if (data.entries.length > 0) {
          setEntries((prev) => [...prev, ...data.entries]);
          if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
          }
          const lastStoppable = [...data.entries].reverse().find((e: any) => e.type === "system" && (e as any).subtype === "stoppable");
          if (lastStoppable !== undefined) onStoppableChange?.((lastStoppable as any).value !== false);
        }
        cursorRef.current = data.nextOffset;
        if ("nextNetworkOffset" in data && data.nextNetworkOffset !== undefined) networkCursorRef.current = data.nextNetworkOffset;
      } catch {}
    };

    fetchLogs();
    if (!isRunning) return;

    const timer = setInterval(fetchLogs, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [issueId, selectedPhase, isRunning]);

  const agentLogs = entries.filter((e: any) => e.type !== "network");
  const networkLogs = entries.filter((e: any) => e.type === "network");

  const lastProgressIdx = agentLogs.reduce(
    (acc: number, e: any, i: number) => (e.type === "progress" ? i : acc),
    -1,
  );
  const hasPostProgressContent =
    lastProgressIdx >= 0 && lastProgressIdx < agentLogs.length - 1;

  const toggleTool = (idx: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleNetwork = (idx: number) => {
    setExpandedNetwork((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Agent logs — top 2/3 */}
      <div className="flex-[2] flex flex-col min-h-0 border-b border-border">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-bg-surface border-b border-border">
          <svg
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            className="text-text-secondary shrink-0"
          >
            <path d="M4 6h16M4 10h16M4 14h16M4 18h12" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">
            Logs
          </span>
          {agentLogs.length > 0 && (
            <span className="text-[10px] font-mono text-text-faint bg-bg-inset px-1.5 py-0.5 rounded">
              {agentLogs.length}
            </span>
          )}
          {agentLogs.length > 0 && (
            <CopyButton getText={() => agentLogs.map((e: any) => `[${e.type}] ${e.text}`).join("\n")} />
          )}
        </div>

        <div ref={logRef} className="flex-1 overflow-y-auto bg-bg-raised">
          <p className="text-[11px] text-text-faint px-3 py-1 border-b border-border-subtle bg-bg-surface/40">
            Logs are stored on the agent's machine — only visible when the agent that ran this issue is connected.
          </p>
          {agentLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[12px] text-text-faint">
              {isRunning ? "Waiting for output..." : "No logs."}
            </div>
          ) : (
            agentLogs.map((entry: any, i: number) => {
              const progressActive =
                entry.type === "progress" &&
                isRunning &&
                i === lastProgressIdx &&
                !hasPostProgressContent;
              return (
                <LogRow
                  key={i}
                  entry={entry}
                  index={i}
                  expanded={expandedTools.has(i)}
                  onToggle={toggleTool}
                  isLast={i === agentLogs.length - 1}
                  progressActive={progressActive}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Network logs — bottom 1/3 */}
      <div className="flex-[1] flex flex-col min-h-0">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-bg-surface border-b border-border">
          <svg
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            className="text-text-secondary shrink-0"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">
            Network
          </span>
          {networkLogs.length > 0 && (
            <span className="text-[10px] font-mono text-text-faint bg-bg-inset px-1.5 py-0.5 rounded">
              {networkLogs.length}
            </span>
          )}
          {networkLogs.length > 0 && (
            <CopyButton getText={() => networkLogs.map((e: any) => e.text).join("\n")} />
          )}
        </div>
        <div className="flex-1 overflow-y-auto bg-bg-raised">
          {networkLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[12px] text-text-faint">
              No traffic
            </div>
          ) : (
            networkLogs.map((entry: any, i: number) => (
              <LogRow
                key={i}
                entry={entry}
                index={i}
                expanded={expandedNetwork.has(i)}
                onToggle={toggleNetwork}
                isLast={i === networkLogs.length - 1}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({
  entry,
  index,
  expanded,
  onToggle,
  isLast,
  progressActive,
}: {
  entry: any;
  index: number;
  expanded: boolean;
  onToggle: (i: number) => void;
  isLast: boolean;
  progressActive?: boolean;
}) {
  const borderClass = isLast ? "" : "border-b border-border-subtle";

  if (entry.type === "section") {
    return (
      <div className="flex items-center gap-3 px-3 py-1.5 bg-bg-surface/50 border-b border-border-subtle">
        <div className="flex-1 h-px bg-border-subtle" />
        <span className="text-[10px] text-text-faint italic shrink-0 font-mono">{entry.text}</span>
        <div className="flex-1 h-px bg-border-subtle" />
      </div>
    );
  }

  if (entry.type === "progress") {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 ${borderClass}`}>
        {progressActive ? (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            className="text-primary animate-spin shrink-0"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.2" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-ok shrink-0"
          >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span className={`text-[12px] ${progressActive ? "text-text-muted" : "text-text-faint"}`}>
          {entry.text}
        </span>
      </div>
    );
  }

  if (entry.type === "system") {
    return (
      <div className={`flex items-center gap-3 px-3 py-1.5 bg-bg-surface/50 ${borderClass}`}>
        <div className="flex-1 h-px bg-border-subtle" />
        <span className="text-[10px] text-text-faint italic shrink-0 font-mono">{entry.text}</span>
        <div className="flex-1 h-px bg-border-subtle" />
      </div>
    );
  }

  if (entry.type === "assistant") {
    return (
      <div className={`px-3 py-2 ${borderClass}`}>
        <p className="text-[13px] text-text-primary leading-relaxed whitespace-pre-wrap">
          {entry.text}
        </p>
      </div>
    );
  }

  if (entry.type === "tool_call") {
    return (
      <div className={borderClass}>
        <button
          className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-bg-surface/40 transition-colors cursor-pointer"
          onClick={() => onToggle(index)}
        >
          <svg
            width="11"
            height="11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            className="text-text-faint shrink-0"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          {entry.tool && (
            <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-bg-surface text-text-secondary shrink-0">
              {entry.tool}
            </span>
          )}
          <span className="text-[11px] text-text-muted truncate flex-1 font-mono">{entry.text}</span>
          <svg
            width="9"
            height="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            className={`text-text-faint shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {expanded && (
          <div className="mx-3 mb-1.5 bg-bg-inset border border-border-subtle rounded overflow-hidden">
            <pre className="text-[11px] font-mono text-text-muted whitespace-pre-wrap break-all leading-relaxed p-2.5 max-h-64 overflow-y-auto">
              {entry.output ?? entry.text}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (entry.type === "result") {
    const isSuccess = entry.icon === "success";
    return (
      <div
        className={`flex items-start gap-2 px-3 py-2 ${isSuccess ? "bg-ok-bg" : "bg-err-bg"} ${borderClass}`}
      >
        <span className={`text-[12px] shrink-0 ${isSuccess ? "text-ok" : "text-err"}`}>
          {isSuccess ? "✓" : "✗"}
        </span>
        <p className={`text-[12px] font-medium ${isSuccess ? "text-ok" : "text-err"}`}>
          {entry.text}
        </p>
      </div>
    );
  }

  if (entry.type === "network") {
    const isBlock = entry.icon === "block";
    const body = entry.text.replace(/^\[(ALLOW|BLOCK)\]\s*/, "");
    const ts = entry.ts
      ? new Date(entry.ts).toTimeString().slice(0, 8)
      : null;
    return (
      <div className={`${isBlock ? "bg-err-bg/50" : "bg-bg-surface/30"} ${borderClass}`}>
        <button
          className="flex items-center gap-2 w-full text-left px-3 py-1 hover:brightness-95 transition-all cursor-pointer"
          onClick={() => onToggle(index)}
        >
          <svg
            width="11"
            height="11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            className={`shrink-0 ${isBlock ? "text-err" : "text-ok"}`}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span
            className={`font-mono text-[10px] font-semibold px-1 py-0.5 rounded shrink-0 ${
              isBlock ? "bg-err-bg text-err" : "bg-ok-bg text-ok"
            }`}
          >
            {isBlock ? "BLOCK" : "ALLOW"}
          </span>
          {ts && (
            <span className="font-mono text-[10px] text-text-faint shrink-0">{ts}</span>
          )}
          <span className="text-[11px] font-mono text-text-muted truncate flex-1">{body}</span>
          <svg
            width="9"
            height="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            className={`text-text-faint shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {expanded && (
          <div className="mx-3 mb-1.5 bg-bg-inset border border-border-subtle rounded overflow-hidden">
            <pre className="text-[11px] font-mono text-text-muted whitespace-pre-wrap break-all leading-relaxed p-2.5">
              {body}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`px-3 py-1 ${borderClass}`}>
      <p className="text-[11px] font-mono text-text-faint whitespace-pre-wrap break-all">
        {entry.text}
      </p>
  </div>
  );
}

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(getText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [getText]);
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className="ml-auto flex items-center gap-1 text-[10px] text-text-faint hover:text-text-secondary transition-colors cursor-pointer px-1"
    >
      {copied ? (
        <>
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Copied</span>
        </>
      ) : (
        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}
