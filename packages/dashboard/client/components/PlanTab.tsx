import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import "highlight.js/styles/github-dark-dimmed.min.css";
import { marked } from "marked";
import hljs from "highlight.js";
import { trpc } from "../trpc";
import { useToast } from "./Toast";

marked.setOptions({
  breaks: false,
  gfm: true,
});

interface PlanSectionProps {
  issueId: number;
  status: string;
  onExecute?: () => void;
}

export function PlanSection({ issueId, status, onExecute }: PlanSectionProps) {
  const [prompt, setPrompt] = useState("");
  const showToast = useToast();
  const utils = trpc.useUtils();

  const isRunning = ["running", "starting"].includes(status);
  const [plan] = trpc.tasks.plan.useSuspenseQuery(
    { id: String(issueId) },
    { retry: false, refetchInterval: status === "running" ? 3000 : false } as any,
  );

  const executeMutation = trpc.actions.execute.useMutation({
    onSuccess: () => {
      showToast(`Issue #${issueId}: execution launched`, "success");
      onExecute?.();
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const cleanupMutation = trpc.actions.cleanup.useMutation({
    onSuccess: () => {
      showToast(`Issue #${issueId}: discarded`, "success");
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const html = useMemo(() => {
    if (!plan) return "";
    const raw = marked.parse(plan) as string;
    const div = document.createElement("div");
    div.innerHTML = raw;
    div.querySelectorAll("pre code").forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });
    return div.innerHTML;
  }, [plan]);

  if (!plan) {
    if (!isRunning) return null;
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-[14px] text-text-secondary">Agent is working on this step…</p>
      </div>
    );
  }

  return (
    <section>
      <div className="rounded-lg border border-border-bright overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface-bright border-b border-border-bright">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="text-text-secondary">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">Plan</span>
          <div className="ml-auto flex items-center gap-2">
            <CopyButton getText={() => plan} />
          </div>
        </div>
        <div className="bg-bg-raised px-5 py-4">
          <div className="result-markdown" dangerouslySetInnerHTML={{ __html: html }} />

        </div>
      </div>
    </section>
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
      className="flex items-center gap-1 text-[10px] text-text-faint hover:text-text-secondary transition-colors cursor-pointer px-1 shrink-0"
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

function ActionBtn({ label, variant, onClick, disabled }: { label: string; variant: string; onClick: () => void; disabled?: boolean }) {
  const styles: Record<string, string> = {
    primary: "bg-primary text-white hover:brightness-110",
    err: "bg-err text-white hover:opacity-90",
    "err-subtle": "text-err border border-err/25 hover:bg-err-bg",
    warn: "text-text-primary border border-border-bright hover:bg-bg-surface",
    muted: "text-text-primary border border-border-bright hover:bg-bg-surface",
  };
  return (
    <button
      className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${styles[variant] || styles.muted}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
