import { useState, useEffect, useRef, type CSSProperties } from "react";
import { trpc } from "../trpc";
import { useAuth } from "../AuthProvider";

const STEP_TIMEOUT_MS = 5 * 60 * 1000;

function useTargetRect(selector: string) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    let ro: ResizeObserver | null = null;

    const attach = (el: Element) => {
      const update = () => requestAnimationFrame(() => setRect(el.getBoundingClientRect()));
      update();
      ro = new ResizeObserver(update);
      ro.observe(el);
    };

    const existing = document.querySelector(`[data-onboarding="${selector}"]`);
    if (existing) {
      attach(existing);
      return () => ro?.disconnect();
    }

    const mo = new MutationObserver(() => {
      const el = document.querySelector(`[data-onboarding="${selector}"]`);
      if (el) { mo.disconnect(); attach(el); }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => { mo.disconnect(); ro?.disconnect(); };
  }, [selector]);
  return rect;
}

function SpotlightCard({ target, pending, children }: { target: string; pending?: boolean; children: React.ReactNode }) {
  const rect = useTargetRect(target);
  const pad = 0;

  if (!rect) return null;

  const bg = "rgba(0,0,0,0.65)";
  const hTop = rect.top - pad;
  const hLeft = rect.left - pad;
  const hRight = rect.right + pad;
  const hBottom = rect.bottom + pad;

  const overlay = (style: CSSProperties): CSSProperties => ({
    position: "fixed",
    background: bg,
    zIndex: 9999,
    pointerEvents: "all",
    ...style,
  });

  const cardWidth = 280;
  const cardHeight = 160;
  const gap = 16;
  const spaceRight = window.innerWidth - hRight - gap;
  const spaceLeft = hLeft - gap;

  const clampTop = (ideal: number) =>
    Math.max(12, Math.min(ideal, window.innerHeight - cardHeight - 12));

  let cardLeft: number;
  let cardTop: number;

  if (spaceRight >= cardWidth) {
    cardLeft = hRight + gap;
    cardTop = clampTop(rect.top + rect.height / 2 - cardHeight / 2);
  } else if (spaceLeft >= cardWidth) {
    cardLeft = hLeft - gap - cardWidth;
    cardTop = clampTop(rect.top + rect.height / 2 - cardHeight / 2);
  } else {
    cardLeft = Math.max(12, Math.min(rect.left, window.innerWidth - cardWidth - 12));
    const spaceBelow = window.innerHeight - hBottom - gap;
    cardTop = spaceBelow >= 120
      ? hBottom + gap
      : Math.max(12, hTop - gap - 120);
  }

  const card: CSSProperties = {
    position: "fixed",
    top: cardTop,
    left: cardLeft,
    width: cardWidth,
    zIndex: 10000,
    pointerEvents: "all",
  };

  return (
    <>
      {/* top */}
      <div style={overlay({ top: 0, left: 0, right: 0, height: hTop })} />
      {/* bottom */}
      <div style={overlay({ top: hBottom, left: 0, right: 0, bottom: 0 })} />
      {/* left */}
      <div style={overlay({ top: hTop, left: 0, width: hLeft, height: hBottom - hTop })} />
      {/* right */}
      <div style={overlay({ top: hTop, left: hRight, right: 0, height: hBottom - hTop })} />
      <div style={card} className="bg-bg-raised border border-border rounded-xl shadow-xl overflow-hidden">
        <div className="p-4">{children}</div>
        {pending && (
          <div className="h-0.5 w-full bg-border overflow-hidden relative">
            <div className="h-full bg-primary absolute animate-[loading-bar_1.4s_ease-in-out_infinite]" />
          </div>
        )}
      </div>
    </>
  );
}

// sub=0  sidebar-sandbox-project  — project created
// sub=1  issue-input-prompt       — read + hit Process (waits for new task)
// sub=2  log-viewer               — plan step running (wait: step_done)
// sub=3  step-content             — review plan
// sub=4  approve-button           — approve plan
// sub=5  log-viewer               — execute step running (wait: finalized)
// sub=6  change-report            — review changes → onComplete
const SUBSTEPS = [
  { target: "sidebar-sandbox-project" },
  { target: "issue-input-prompt" },
  { target: "log-viewer" },
  { target: "step-content" },
  { target: "approve-button" },
  { target: "log-viewer" },
  { target: "change-report" },
] as const;

interface Props {
  projectId: string;
  onComplete: () => void;
  onSkip: () => void;
}

function ErrorCard({ message, onSkip }: { message: string; onSkip: () => void }) {
  return (
    <div>
      <p className="text-[13px] text-text-primary font-medium mb-1">Something went wrong</p>
      <p className="text-[12px] text-text-muted mb-3">{message}</p>
      <div className="flex justify-end">
        <button
          onClick={onSkip}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-border text-text-muted hover:bg-bg-surface cursor-pointer"
        >
          Skip setup
        </button>
      </div>
    </div>
  );
}

export function OnboardingStep2({ projectId, onComplete, onSkip }: Props) {
  const { updateOnboardingStep } = useAuth();
  const [sub, setSub] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const advancedRef = useRef(false);
  const initialTaskCountRef = useRef<number | null>(null);
  const activeTaskIdRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: agentConnected } = trpc.system.agentConnected.useQuery(undefined, { refetchInterval: 5000 });

  const { data: tasks = [], error: tasksError } = trpc.tasks.list.useQuery(
    { projectId },
    { refetchInterval: sub <= 1 ? 1000 : 3000, retry: 2 },
  );

  useEffect(() => {
    if (tasksError) setError("Failed to load tasks. The server may be unreachable.");
  }, [tasksError]);

  const activeTask = activeTaskIdRef.current !== null
    ? (tasks as any[]).find((t) => t.task_id === activeTaskIdRef.current)
    : null;
  const taskStatus = activeTask?.status;
  const planDone = taskStatus === "step_done";

  // Timeout on waiting substeps (sub=2 and sub=5)
  useEffect(() => {
    if (sub !== 2 && sub !== 5) return;
    if (planDone) return;
    timeoutRef.current = setTimeout(() => {
      setError(`The agent did not complete in time (step ${sub === 2 ? "plan" : "execute"}, task #${activeTaskIdRef.current ?? "unknown"}).`);
    }, STEP_TIMEOUT_MS);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [sub, planDone]);

  useEffect(() => {
    if (planDone && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [planDone]);

  // Snapshot task count when entering sub=1
  useEffect(() => {
    if (sub === 1) initialTaskCountRef.current = tasks.length;
  }, [sub]);

  // Advance from sub=1 when a new task appears → jump to logs (sub=2)
  useEffect(() => {
    if (sub === 1 && initialTaskCountRef.current !== null && tasks.length > initialTaskCountRef.current) {
      const newest = (tasks as any[]).at(-1);
      if (newest) activeTaskIdRef.current = newest.task_id;
      setSub(2);
    }
  }, [tasks.length, sub]);

  // Advance from sub=4 when user clicks approve → task starts running again
  useEffect(() => {
    if (sub === 4 && (taskStatus === "running" || taskStatus === "starting")) {
      setSub(5);
    }
  }, [taskStatus, sub]);

  // Task errored out
  useEffect(() => {
    if (activeTask?.status === "failed" || activeTask?.status === "error") {
      setError(`The agent encountered an error on task #${activeTaskIdRef.current}.`);
    }
  }, [activeTask?.status]);

  const next = () => {
    if (sub === SUBSTEPS.length - 1) {
      if (!advancedRef.current) {
        advancedRef.current = true;
        updateOnboardingStep(3).then(() => onComplete());
      }
    } else {
      setSub((s) => s + 1);
    }
  };

  const step = SUBSTEPS[sub];

  const checkBtn = (disabled = false) => (
    <div className="flex justify-end mt-3">
      <button
        onClick={next}
        disabled={disabled}
        className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${disabled ? "border-border text-text-faint cursor-not-allowed" : "border-primary text-primary hover:bg-primary hover:text-white cursor-pointer"}`}
      >
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );

  if (error) {
    return <SpotlightCard target={step.target}><ErrorCard message={error} onSkip={onSkip} /></SpotlightCard>;
  }

  let card: React.ReactNode;
  if (sub === 0) {
    card = <div><p className="text-[13px] text-text-primary mb-3">We created a sandbox project for you.</p>{checkBtn()}</div>;
  } else if (sub === 1) {
    card = (
      <div>
        <p className="text-[13px] text-text-primary mb-3">Here's your first task. Read the prompt, then hit Process when you're ready.</p>
        <div className="flex items-start gap-1.5">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-warn/70 shrink-0 self-center"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <p className="text-[12px] text-warn/70"><span className="font-medium">This is a real demo</span> — it will use a small amount of your API tokens.</p>
        </div>
      </div>
    );
  } else if (sub === 2) {
    card = (
      <div>
        <p className="text-[13px] text-text-primary mb-3">The agent is building a plan.</p>
        <p className="text-[12px] text-text-muted mb-3">Wait for the plan step to complete before continuing.</p>
        {checkBtn(!planDone)}
      </div>
    );
  } else if (sub === 3) {
    card = <div><p className="text-[13px] text-text-primary mb-3">Review the plan the agent wrote.</p>{checkBtn()}</div>;
  } else if (sub === 4) {
    card = <div><p className="text-[13px] text-text-primary mb-3">Approve the plan to kick off execution.</p></div>;
  } else if (sub === 5) {
    card = (
      <div>
        <p className="text-[13px] text-text-primary mb-3">The agent is now executing the changes.</p>
        <p className="text-[12px] text-text-muted mb-3">Wait for execution to complete before continuing.</p>
        {checkBtn(!planDone)}
      </div>
    );
  } else {
    card = (
      <div>
        <p className="text-[13px] text-text-primary mb-3">Here's what changed in the codebase.</p>
        <p className="text-[12px] text-text-muted mb-3">Review the diff, then connect your own repo to get started.</p>
        {checkBtn()}
      </div>
    );
  }

  const pending = (sub === 2 && !planDone) || (sub === 5 && !planDone);
  return <SpotlightCard target={step.target} pending={pending}>{card}</SpotlightCard>;
}
