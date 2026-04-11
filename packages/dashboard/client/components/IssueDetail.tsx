import { useEffect, useRef, useState, Suspense, lazy } from "react";
import { DeliverySection } from "./modules/DeliverySection";
import { UnitTestsSection } from "./modules/UnitTestsSection";
import { ManualQASection } from "./modules/ManualQASection";
import { ChangeReport } from "./modules/ChangeReport";
import { StatusBadge } from "./StatusBadge";
import { PhaseStepper } from "./Stepper";
const PlanSection = lazy(() => import("./PlanTab").then((m) => ({ default: m.PlanSection })));
const IssueUpdateSection = lazy(() => import("./modules/IssueUpdateSection").then((m) => ({ default: m.IssueUpdateSection })));
import { LogSection } from "./LogViewer";
import { ErrorBoundary } from "./ErrorBoundary";
import { formatActiveTime, useLiveTick } from "../lib/format";
import { trpc } from "../trpc";
import { useToast } from "./Toast";
import type { TaskData } from "./IssueRow";

function PromptBadge({ taskId }: { taskId: number }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = trpc.tasks.prompt.useQuery(
    { taskId },
    { enabled: open },
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popoverRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-semibold text-text-primary bg-bg-surface border border-border rounded px-2 py-0.5 cursor-pointer hover:border-primary/40 transition-colors"
      >
        Prompt
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full mt-1 z-50 w-[420px] max-h-64 overflow-y-auto bg-bg-raised border border-border rounded-lg shadow-lg p-3"
        >
          {isFetching ? (
            <span className="text-[12px] text-text-faint">Loading…</span>
          ) : (
            <pre className="text-[12px] text-text-primary whitespace-pre-wrap font-sans leading-relaxed">{data?.prompt ?? "(not found)"}</pre>
          )}
        </div>
      )}
    </div>
  );
}

interface IssueDetailProps {
  issue: TaskData;
  onOpenTerminal: (taskId: string) => void;
  onChangeTerminal: (taskId: string) => void;
  initialStep?: string;
  onStepChange?: (slug: string) => void;
}

export function IssueDetail({ issue, onOpenTerminal, onChangeTerminal, initialStep, onStepChange }: IssueDetailProps) {
  const [refineText, setRefineText] = useState("");
  const [showRefineSidebar, setShowRefineSidebar] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [isStoppable, setIsStoppable] = useState(true);
  const currentSlug = issue.current_step_slug ?? issue.step;
  const [selectedPhase, setSelectedPhase] = useState<string>(initialStep ?? currentSlug);
  const [executePrompt, setExecutePrompt] = useState("");
  const showToast = useToast();
  const utils = trpc.useUtils();

  const refineMutation = trpc.actions.refine.useMutation({
    onSuccess: () => {
      setRefineText("");
      setShowRefineSidebar(false);
      utils.tasks.invalidate();
    },
  });

  const advanceMutation = trpc.actions.advance.useMutation({
    onSuccess: (data) => {
      showToast(data.message, "success");
      setExecutePrompt("");
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const continueMutation = trpc.actions.continue.useMutation({
    onSuccess: () => {
      showToast(`Task #${issue.task_id}: resuming session`, "success");
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const relaunchMutation = trpc.actions.relaunch.useMutation({
    onSuccess: () => {
      showToast(`Task #${issue.task_id}: relaunching phase`, "success");
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const stopMutation = trpc.actions.stop.useMutation({
    onSuccess: () => {
      showToast(`Task #${issue.task_id}: session stopped`, "success");
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const devServersMutation = trpc.actions.devServers.useMutation({
    onSuccess: (data) => {
      const names = data.launched.map((s) => `${s.name} (:${s.port})`).join(", ");
      showToast(`Dev servers launched: ${names}`, "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  // Sync selected phase when task changes or phase advances
  useEffect(() => {
    setRefineText("");
    setSelectedPhase(issue.current_step_slug ?? issue.step);
  }, [issue.task_id]);

  useEffect(() => {
    if (issue.status === "running" || issue.status === "starting") {
      setSelectedPhase(issue.current_step_slug ?? issue.step);
    }
  }, [issue.step, issue.current_step_slug, issue.status]);

  const s = issue.status;
  useLiveTick(s === "running" || s === "starting");
  const isPending =
    continueMutation.isPending ||
    relaunchMutation.isPending ||
    stopMutation.isPending ||
    advanceMutation.isPending;

  const canContinue =
    (s === "failed" && issue.failure_reason === "max_turns") ||
    (s === "stopped" && !!issue.session_id);

  const showRefine = !["running", "starting", "cleaned_up"].includes(s) && issue.session_id;

  const handleRefine = () => {
    if (!refineText.trim()) return;
    refineMutation.mutate({ id: String(issue.task_id), prompt: refineText.trim(), phase: selectedPhase });
  };

  const executeMutation = trpc.actions.execute.useMutation({
    onSuccess: () => {
      setApproveNote("");
      utils.tasks.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const transitions = issue.step_transitions ?? [];
  const defaultTransition = transitions.find((t: any) => t.isDefault && t.toStepId !== null);
  const nextStepName = defaultTransition
    ? (issue.workflow_steps?.find((ws: any) => ws.id === defaultTransition.toStepId)?.name ?? "Next")
    : null;

  const showApproveBar = ["stopped", "failed", "step_done"].includes(s) && nextStepName;
  const approveLabel = (s === "step_done" || !!issue.plan_summary) ? "Approve" : `Skip to ${nextStepName}`;

  const handleApprove = () => {
    executeMutation.mutate({ id: String(issue.task_id), prompt: approveNote.trim() || undefined });
  };

  // Step info for the selected phase (not necessarily current)
  const currentStep = issue.workflow_steps?.find((s: any) => s.slug === selectedPhase);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 px-4 border-b border-border bg-bg-raised flex flex-col">
        {/* Row 1: id/status/duration/provider + action buttons */}
        <div className="h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {issue.source_type === "prompt" ? (
              <PromptBadge taskId={issue.task_id} />
            ) : issue.issue_url ? (
              <a
                href={issue.issue_url}
                target="_blank"
                rel="noopener"
                className="text-[12px] font-mono text-primary-muted bg-bg-surface px-2 py-0.5 rounded hover:underline shrink-0"
              >
                #{issue.task_id}
              </a>
            ) : (
              <span className="text-[12px] font-mono text-text-faint bg-bg-surface px-2 py-0.5 rounded shrink-0">
                #{issue.task_id}
              </span>
            )}
            <StatusBadge status={s} />
            {issue.phase_timings && (
              <span className="text-[11px] text-text-muted shrink-0">
                {formatActiveTime(issue.phase_timings, s === "running" || s === "starting")}
              </span>
            )}
            {issue.llm_provider && (
              <span className="text-[11px] font-mono text-text-muted bg-bg-surface px-2 py-0.5 rounded border border-border-subtle shrink-0">
                {issue.llm_provider}{issue.llm_model ? ` / ${issue.llm_model}` : ""}
              </span>
            )}
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(s === "running" || s === "starting") && (
              <ActionBtn
                label="Stop"
                variant="err"
                onClick={() => stopMutation.mutate({ id: String(issue.task_id) })}
                disabled={isPending || !isStoppable}
              />
            )}
            {canContinue && (
              <ActionBtn
                label="Continue"
                variant="primary"
                onClick={() => continueMutation.mutate({ id: String(issue.task_id) })}
                disabled={isPending}
              />
            )}
            {s === "failed" && (
              <ActionBtn
                label="Relaunch"
                variant="primary"
                onClick={() => relaunchMutation.mutate({ id: String(issue.task_id) })}
                disabled={isPending}
              />
            )}


            {s !== "cleaned_up" && s !== "starting" && (
              <ActionBtn
                label="Dev Servers"
                variant="warn"
                onClick={() => devServersMutation.mutate({ id: String(issue.task_id) })}
                disabled={isPending || devServersMutation.isPending}
                loadingLabel={devServersMutation.isPending ? "Building…" : undefined}
              />
            )}
            {!["running", "starting", "cleaned_up"].includes(s) && !!issue.session_id && (
              <SplitBtn
                label="Sandbox Shell"
                onClick={() => onOpenTerminal(String(issue.task_id))}
                disabled={isPending}
                menuItems={[{ label: "Change terminal", onClick: () => onChangeTerminal(String(issue.task_id)) }]}
              />
            )}
            {showRefine && (
              <ActionBtn
                label="Refine"
                variant="muted"
                onClick={() => setShowRefineSidebar((v) => !v)}
                disabled={isPending}
              />
            )}
          </div>
        </div>
        {/* Row 2: stepper */}
        <div className="flex pb-3" data-onboarding="phase-stepper">
          <div className="flex-1 flex justify-center">
            <PhaseStepper
              phase={issue.current_step_slug ?? issue.step}
              status={s}
              phaseTimingsRaw={issue.phase_timings}
              availableLogs={issue.available_logs}
              selectedPhase={selectedPhase}
              onSelectPhase={(slug) => { setSelectedPhase(slug); onStepChange?.(slug); }}
              workflowSteps={issue.workflow_steps}
            />
          </div>
          <div className="w-90 2xl:w-120 shrink-0" />
        </div>
      </div>

      {/* Error bar */}
      {issue.error && (
        <div className="shrink-0 px-6 py-2 bg-err-bg border-b border-err/15">
          <p className="text-[12px] text-err leading-snug">{issue.error}</p>
        </div>
      )}

      {/* Main content: phase pane (left) + live feed (right) */}
      <div className="flex-1 flex min-h-0">
        {/* Phase content + approve bar */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto" data-onboarding="step-content">
            <div className="px-6 py-6 space-y-6">
              <ErrorBoundary>
                <Suspense fallback={
                  <div className="space-y-3 animate-pulse">
                    <div className="h-4 bg-bg-surface rounded w-2/3" />
                    <div className="h-4 bg-bg-surface rounded w-full" />
                    <div className="h-4 bg-bg-surface rounded w-5/6" />
                    <div className="h-4 bg-bg-surface rounded w-3/4" />
                    <div className="h-4 bg-bg-surface rounded w-1/2" />
                  </div>
                }>
                  <StepContent
                    stepSlug={selectedPhase}
                    currentStep={currentStep}
                    issue={issue}
                    status={s}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>

          {/* Approve / Skip bar */}
          {showApproveBar && (
            <div className="shrink-0 px-6 py-4 border-t border-border bg-bg-raised flex items-center gap-3">
              <textarea
                className="flex-1 bg-bg-inset border border-border rounded-lg px-3.5 py-2.5 text-[13px] text-text-primary placeholder-text-faint resize-none h-[60px] focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
                placeholder="Optional note..."
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
              />
              <button
                data-onboarding="approve-button"
                className={`shrink-0 px-4 py-2 rounded-lg text-[12px] font-medium bg-primary text-white transition-all ${
                  executeMutation.isPending ? "opacity-40 cursor-not-allowed" : "hover:brightness-110 cursor-pointer"
                }`}
                onClick={handleApprove}
                disabled={executeMutation.isPending}
              >
                {approveLabel}
              </button>
            </div>
          )}
        </div>

        {/* Live feed */}
        <div className="w-90 2xl:w-120 shrink-0 border-l border-border flex flex-col min-h-0" data-onboarding="log-viewer">
          <LogSection
            key={selectedPhase}
            issueId={issue.task_id}
            status={s}
            selectedPhase={selectedPhase}
            onStoppableChange={setIsStoppable}
          />
        </div>
      </div>

      {/* Refine drawer */}
      <div
        className={`fixed inset-0 bg-bg-overlay z-200 transition-opacity duration-250 ${showRefineSidebar ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={() => setShowRefineSidebar(false)}
      />
      <aside
        className={`fixed top-0 right-0 bottom-0 w-[min(520px,90vw)] bg-bg-raised border-l border-border z-210 flex flex-col shadow-lg transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${showRefineSidebar ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <span className="text-[13px] font-semibold text-text-primary">Refine</span>
          <button className="text-text-muted hover:text-text-primary transition-colors cursor-pointer" onClick={() => setShowRefineSidebar(false)}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="flex-1 flex flex-col p-6 gap-4">
          <textarea
            className="bg-bg-inset border border-border rounded-lg px-4 py-3 text-[13px] text-text-primary placeholder-text-faint resize-none h-40 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
            placeholder="Refine instructions..."
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleRefine();
              }
            }}
          />
          <div className="flex items-center justify-between shrink-0">
            <p className="text-[11px] text-text-faint">Cmd+Enter to send</p>
            <button
              className={`px-4 py-2 rounded-lg text-[13px] font-medium bg-primary text-white transition-all ${!refineText.trim() || refineMutation.isPending ? "opacity-40 cursor-not-allowed" : "hover:brightness-110 cursor-pointer"}`}
              onClick={handleRefine}
              disabled={!refineText.trim() || refineMutation.isPending}
            >
              {refineMutation.isPending ? "Sending..." : "Refine"}
            </button>
          </div>
        </div>
      </aside>

    </div>
  );
}


function StepContent({
  stepSlug,
  currentStep,
  issue,
  status,
}: {
  stepSlug: string;
  currentStep?: { slug: string; modules?: { name: string; prompt: string }[] };
  issue: TaskData;
  status: string;
}) {
  const moduleNames = ((currentStep?.modules ?? []) as { name: string }[]).map((m) => m.name);

  const hasPlan = moduleNames.includes("plan");
  const hasDelivery = moduleNames.includes("delivery");
  const hasUnitTests = moduleNames.includes("unit_tests");
  const hasManualQA = moduleNames.includes("manual_qa");
  const hasIssueUpdate = moduleNames.includes("issue_update");
  const hasChangeReport = moduleNames.includes("change_report");

  return (
    <>
      {hasPlan && <PlanSection issueId={issue.task_id} status={status} onExecute={() => {}} />}
      {hasDelivery && <DeliverySection issueId={issue.task_id} stepSlug={stepSlug} status={status} issueSource={issue.issue_source} />}
      {hasUnitTests && <UnitTestsSection issueId={issue.task_id} stepSlug={stepSlug} status={status} />}
      {hasManualQA && <ManualQASection issueId={issue.task_id} stepSlug={stepSlug} status={status} />}
      {hasIssueUpdate && <IssueUpdateSection issueId={issue.task_id} stepSlug={stepSlug} status={status} issueSource={issue.issue_source} />}
      {hasChangeReport && <ChangeReport issueId={issue.task_id} status={status} />}
    </>
  );
}

function SplitBtn({ label, onClick, disabled, menuItems }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  menuItems: { label: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const base = "text-text-primary border border-border-bright hover:bg-bg-surface transition-all text-[13px] font-medium";

  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`${base} px-3.5 py-1.5 rounded-l-lg border-r-0 ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
      >
        {label}
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`${base} px-2 py-1.5 rounded-r-lg ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-bg-raised border border-border rounded-lg shadow-xl z-20 min-w-[160px] py-1">
          {menuItems.map((item) => (
            <button
              key={item.label}
              onClick={() => { item.onClick(); setOpen(false); }}
              className="w-full text-left px-3.5 py-2 text-[12px] text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


function ActionBtn({
  label,
  variant,
  onClick,
  disabled,
  loadingLabel,
}: {
  label: string;
  variant: string;
  onClick: () => void;
  disabled?: boolean;
  loadingLabel?: string;
}) {
  const styles: Record<string, string> = {
    primary: "bg-primary text-white hover:brightness-110",
    err: "bg-err text-white hover:opacity-90",
    "err-subtle": "text-err border border-err/25 hover:bg-err-bg",
    warn: "text-text-primary border border-border-bright hover:bg-bg-surface",
    muted: "text-text-primary border border-border-bright hover:bg-bg-surface",
  };
  const isLoading = !!loadingLabel;
  return (
    <button
      className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
        disabled || isLoading ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${styles[variant] || styles.muted}`}
      onClick={onClick}
      disabled={disabled || isLoading}
    >
      {isLoading ? loadingLabel : disabled ? "..." : label}
    </button>
  );
}
