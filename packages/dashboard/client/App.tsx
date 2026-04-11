import { useState, useCallback, useEffect, useRef, Component, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { ReactNode, ErrorInfo } from "react";
import { Routes, Route, Navigate, useParams, useNavigate, useLocation } from "react-router";
import { trpc } from "./trpc";
import { useAuth } from "./AuthProvider";
import { OrgSwitcher } from "./components/OrgSwitcher";
import { SidebarMenu } from "./components/SidebarMenu";
import { OrgSettingsPanel } from "./components/OrgSettingsPanel";
import { AccountSettingsPanel } from "./components/AccountSettingsPanel";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { InvitePage } from "./pages/InvitePage";
import { DeviceAuthPage } from "./pages/DeviceAuthPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { VerifyEmailChangePage } from "./pages/VerifyEmailChangePage";
import { GoogleCallbackPage } from "./pages/GoogleCallbackPage";
import { StatusFilter } from "./components/StatusFilter";
import { IssueList } from "./components/IssueList";
import { IssueInput } from "./components/IssueInput";
import { IssueDetail } from "./components/IssueDetail";
import { ToastProvider, useToast } from "./components/Toast";
import { ResourceBar } from "./components/ResourceBar";
import { ProjectSelector } from "./components/ProjectSelector";
import { ProjectSettingsPanel } from "./components/ProjectSettingsPanel";
import { BuildProgress } from "./components/BuildProgress";
import { TerminalPicker } from "./TerminalPicker";
import { OnboardingOverlay, SkipBanner, OnboardingDevTools, DEMO_PROMPT, SANDBOX_PROJECT_KEY } from "./components/OnboardingOverlay";
import { OnboardingContent } from "./components/OnboardingPage";
import { identify, resetIdentity, track } from "./lib/analytics";
import type { TaskData } from "./components/IssueRow";

const STORAGE_KEY = "dashboard_active_project";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <div className="h-screen bg-bg" />;
  if (!user) return <Navigate to="/signin" state={{ from: location }} replace />;
  return <>{children}</>;
}

function TaskListSlot({ projectId, noProjects, selectedId, focusedIndex, hiddenStatuses, issueUrlTemplate, onSelect, onToggleStatus }: {
  projectId: string | null;
  noProjects: boolean;
  selectedId: number | null;
  focusedIndex: number;
  hiddenStatuses: Set<string>;
  issueUrlTemplate: string;
  onSelect: (id: number | null) => void;
  onToggleStatus: (status: string) => void;
}) {
  const [issues] = trpc.tasks.list.useSuspenseQuery(
    noProjects ? undefined : (projectId ? { projectId } : undefined),
    { refetchInterval: noProjects ? false : 5000, enabled: !noProjects && !!projectId } as any,
  );

  const statusCounts = [...new Set(issues.map((i: any) => i.status))]
    .sort()
    .map((status) => ({ status, count: issues.filter((i: any) => i.status === status).length }));

  const filtered = issues.filter((i: any) => !hiddenStatuses.has(i.status)) as TaskData[];

  return (
    <>
      {statusCounts.length > 0 && (
        <div className="shrink-0 px-6 py-2.5 border-b border-border">
          <StatusFilter statuses={statusCounts} hiddenStatuses={hiddenStatuses} onToggle={onToggleStatus} />
        </div>
      )}
      <IssueList
        issues={filtered}
        selectedId={selectedId}
        focusedIndex={focusedIndex}
        onSelect={onSelect}
        issueUrlTemplate={issueUrlTemplate}
      />
    </>
  );
}

function SidebarInputSlot({ projectId, buildState, onOpenSettings, onInitialized, prefillPrompt }: {
  projectId: string | null;
  buildState: { status: string; step?: string; progress?: number; error?: string } | undefined;
  onOpenSettings: (sec?: string) => void;
  onInitialized: (id: number) => void;
  prefillPrompt?: string;
}) {
  const [projectsList] = trpc.projects.list.useSuspenseQuery();
  const noProjects = projectsList.length === 0;

  if (noProjects) {
    return (
      <div className="shrink-0 px-4 py-3 border-b border-border">
        <button
          onClick={() => onOpenSettings("new-project")}
          className="w-full py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[13px] font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
        >
          + New project
        </button>
      </div>
    );
  }

  if (buildState?.status === "building" || buildState?.status === "error") {
    return (
      <div className="shrink-0 px-5 py-4 border-b border-border">
        <BuildProgress step={buildState.step ?? ""} progress={buildState.progress ?? 0} status={buildState.status} />
      </div>
    );
  }

  return (
    <IssueInput
      projectId={projectId}
      projectDefaults={projectsList.find((p) => p.project_id === projectId) ?? null}
      onInitialized={onInitialized}
      prefillPrompt={prefillPrompt}
    />
  );
}

function AgentStatusDot() {
  const { data: connected } = trpc.system.agentConnected.useQuery(undefined, { refetchInterval: 5000 });
  const trackedRef = useRef(false);
  useEffect(() => {
    if (connected && !trackedRef.current) {
      trackedRef.current = true;
      track("agent_connected");
    }
  }, [connected]);
  const label = connected ? "Agent connected" : "Agent not connected";
  return (
    <div className="shrink-0 ml-auto group flex items-center gap-1.5 cursor-default">
      <span className={`text-[13px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap ${connected ? "text-text-secondary" : "text-err"}`}>
        {label}
      </span>
      {connected ? (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
        </span>
      ) : (
        <span className="h-2 w-2 rounded-full bg-err" />
      )}
    </div>
  );
}

function Dashboard() {
  const { projectId, taskId, stepSlug, section, workflowId } = useParams<{ projectId: string; taskId: string; stepSlug: string; section: string; workflowId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (user) identify(String(user.id), { email: user.email, orgId: user.orgId, orgName: user.orgName });
  }, [user?.id, user?.orgId]);

  const isOnboarding = !!user && !user.onboardingCompletedAt && user.onboardingStep < 2;
  const orgSettingsOpen = location.pathname === "/org/settings";
  const accountSettingsOpen = location.pathname === "/account/settings";

  const selectedId = taskId ? parseInt(taskId) : null;
  const settingsOpen = location.pathname.includes("/settings");
  const createProjectMode = location.pathname.endsWith("/new-project");
  // null = new workflow, number = edit, undefined = closed
  const workflowBuilderTarget: number | null | undefined = workflowId === "new" ? null : workflowId ? parseInt(workflowId) : undefined;

  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(new Set(["cleaned_up"]));
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [terminalPickerIssueId, setTerminalPickerIssueId] = useState<string | null>(null);
  const showToast = useToast();

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("theme") as "dark" | "light") || "dark";
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const { data: projectsList = [] } = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();

  const sandboxProjectId = localStorage.getItem(SANDBOX_PROJECT_KEY);
  const prefillPrompt = (!user?.onboardingCompletedAt && user?.onboardingStep === 2 && projectId === sandboxProjectId) ? DEMO_PROMPT : undefined;

  // Keep localStorage in sync
  useEffect(() => {
    if (projectId) localStorage.setItem(STORAGE_KEY, projectId);
  }, [projectId]);

  // Auto-redirect to default project when at root with no projectId
  useEffect(() => {
    const hasSub = new URLSearchParams(location.search).has("sub");
    if (projectId || projectsList.length === 0 || orgSettingsOpen || accountSettingsOpen || settingsOpen || isOnboarding || hasSub) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    const target = (stored && projectsList.find((p) => p.project_id === stored))
      ? stored
      : projectsList[0]?.project_id;
    if (target) navigate(`/${target}`, { replace: true });
  }, [projectId, projectsList, orgSettingsOpen, accountSettingsOpen, settingsOpen, isOnboarding, location.search]);

  const openTerminalMutation = trpc.actions.openTerminal.useMutation({
    onSuccess: (_, vars) => showToast(`Sandbox shell opened for task #${vars.id}`, "success"),
    onError: (err) => showToast(err.message, "error"),
  });

  const handleOpenTerminal = useCallback((id: string) => {
    const saved = localStorage.getItem("preferred_terminal");
    if (saved) {
      openTerminalMutation.mutate({ id, terminalId: saved });
    } else {
      setTerminalPickerIssueId(id);
    }
  }, [openTerminalMutation]);

  const handleTerminalPicked = useCallback((terminalId: string, remember: boolean) => {
    if (remember) localStorage.setItem("preferred_terminal", terminalId);
    if (terminalPickerIssueId) {
      openTerminalMutation.mutate({ id: terminalPickerIssueId, terminalId });
    }
    setTerminalPickerIssueId(null);
  }, [openTerminalMutation, terminalPickerIssueId]);

  const switchProject = useCallback((pid: string) => {
    navigate(`/${pid}`);
    utils.tasks.invalidate();
    utils.projects.invalidate();
  }, [navigate, utils]);

  const openSettings = useCallback((sec?: string) => {
    const base = projectId ? `/${projectId}/settings` : "/settings";
    navigate(`${base}${sec ? `/${sec}` : ""}`);
  }, [navigate, projectId]);

  const closeSettings = useCallback(() => {
    navigate(projectId ? `/${projectId}` : "/");
  }, [navigate, projectId]);

  const noProjects = projectsList.length === 0;

  const { data: issues = [], isFetched: issuesFetched } = trpc.tasks.list.useQuery(
    noProjects ? undefined : (projectId ? { projectId } : undefined),
    { refetchInterval: noProjects ? false : 5000, enabled: !noProjects && !!projectId },
  );

  const selectIssue = useCallback((id: number | null) => {
    if (id === null) {
      navigate(`/${projectId}`);
    } else {
      const issue = issues.find((i: any) => i.task_id === id);
      const slug = issue?.current_step_slug ?? issue?.step;
      navigate(slug ? `/${projectId}/tasks/${id}/${slug}` : `/${projectId}/tasks/${id}`);
    }
  }, [navigate, projectId, issues]);

  const prevCompletedIds = useRef<Set<number>>(new Set());
  const prevFailedIds = useRef<Set<number>>(new Set());
  useEffect(() => {
    const currentCompletedIds = new Set(
      issues
        .filter((i: any) => i.status === "step_done" && (!i.step_transitions || i.step_transitions.length === 0))
        .map((i: any) => i.task_id as number),
    );
    const newlyCompleted = [...currentCompletedIds].filter((id) => !prevCompletedIds.current.has(id));
    if (newlyCompleted.length > 0) {
      setTimeout(() => utils.tasks.browse.invalidate(), 2000);
      newlyCompleted.forEach(() => track("issue_completed"));
    }
    prevCompletedIds.current = currentCompletedIds;

    const currentFailedIds = new Set(
      issues.filter((i: any) => i.status === "failed").map((i: any) => i.task_id as number),
    );
    const newlyFailed = [...currentFailedIds].filter((id) => !prevFailedIds.current.has(id));
    newlyFailed.forEach(() => track("issue_failed"));
    prevFailedIds.current = currentFailedIds;
  }, [issues]);

  const toggleStatus = useCallback((status: string) => {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const statusCounts = [...new Set(issues.map((i: any) => i.status))]
    .sort()
    .map((status) => ({
      status,
      count: issues.filter((i: any) => i.status === status).length,
    }));

  const filtered = issues.filter((i: any) => !hiddenStatuses.has(i.status)) as TaskData[];
  const activeCount = issues.filter((i: any) =>
    i.status === "running" || i.status === "starting",
  ).length;

  const selectedIssue = filtered.find((i: any) => i.task_id === selectedId) as TaskData | undefined ?? null;

  // Clear selection only when the task no longer exists at all (not just filtered out)
  useEffect(() => {
    if (!issuesFetched) return;
    if (selectedId && !issues.some((i: any) => i.task_id === selectedId)) {
      selectIssue(null);
    }
  }, [issues, selectedId, issuesFetched]);

  const { data: resources } = trpc.system.resources.useQuery(
    projectId ? { projectId } : undefined,
    { refetchInterval: 5000 },
  );

  const { data: buildState } = trpc.system.buildStatus.useQuery(
    { projectId: projectId! },
    {
      enabled: !!projectId,
      refetchInterval: (query) => {
        const s = (query.state.data as { status: string } | undefined)?.status;
        return s === "building" ? 500 : 5000;
      },
    },
  );

  const prevBuildStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!buildState) return;
    const prev = prevBuildStatus.current;
    prevBuildStatus.current = buildState.status;
    if (prev === "building" && buildState.status === "done") {
      showToast("Runtime image built", "success");
    } else if (prev === "building" && buildState.status === "error") {
      showToast(`Build failed: ${buildState.error ?? "unknown error"}`, "error");
    }
  }, [buildState?.status]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "j") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < filtered.length) {
        e.preventDefault();
        selectIssue(filtered[focusedIndex].task_id);
      } else if (e.key === "Escape") {
        const onboardingOverlayActive = !!user && !user.onboardingCompletedAt && user.onboardingStep >= 2;
        if (onboardingOverlayActive) return;
        e.preventDefault();
        if (terminalPickerIssueId !== null) setTerminalPickerIssueId(null);
        else if (orgSettingsOpen || accountSettingsOpen) closeSettings();
        else if (selectedIssue) selectIssue(null);
      }
    },
    [user, filtered, focusedIndex, orgSettingsOpen, accountSettingsOpen, terminalPickerIssueId, selectedIssue, selectIssue, closeSettings],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    setFocusedIndex(-1);
  }, [hiddenStatuses]);

  return (
    <div className="h-screen flex bg-bg text-text-primary">
      {/* Left Sidebar */}
      <aside className="w-[320px] 2xl:w-[400px] shrink-0 border-r border-border flex flex-col bg-bg-raised">
        {/* Sidebar Header */}
        <div className="shrink-0 h-14 px-3 border-b border-border flex items-center gap-2">
          <SidebarMenu
            projectId={projectId}
            theme={theme}
            onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
            onOpenOrgSettings={() => navigate("/org/settings")}
            onboarding={isOnboarding}
          />
          {!isOnboarding && (
            <>
              <OrgSwitcher />
              {activeCount > 0 && (
                <span className="text-[10px] font-bold bg-primary-subtle text-primary px-2 py-0.5 rounded-full shrink-0">
                  {activeCount} active
                </span>
              )}
              <AgentStatusDot />
            </>
          )}
        </div>

        {/* Project Selector Bar */}
        {!isOnboarding && <div
          className="shrink-0 px-4 py-2.5 border-b border-border"
          {...(projectId === sandboxProjectId ? { "data-onboarding": "sidebar-sandbox-project" } : {})}
        >
          <ProjectSelector
            projects={projectsList}
            activeProjectId={projectId ?? null}
            onSelect={switchProject}
            onManage={() => openSettings()}
          />
        </div>}

        {!isOnboarding && <><SkipBanner />
        <ErrorBoundary>
          <Suspense fallback={null}>
            <SidebarInputSlot
              projectId={projectId ?? null}
              buildState={buildState}
              onOpenSettings={openSettings}
              onInitialized={selectIssue}
              prefillPrompt={prefillPrompt}
            />
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary>
          <Suspense fallback={
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="animate-pulse h-[60px] bg-bg-surface rounded-lg" style={{ opacity: 1 - i * 0.13 }} />
              ))}
            </div>
          }>
            <TaskListSlot
              projectId={projectId ?? null}
              noProjects={noProjects}
              selectedId={selectedId}
              focusedIndex={focusedIndex}
              hiddenStatuses={hiddenStatuses}
              issueUrlTemplate={projectsList.find((p) => p.project_id === projectId)?.issue_url_template ?? ""}
              onSelect={selectIssue}
              onToggleStatus={toggleStatus}
            />
          </Suspense>
        </ErrorBoundary>

        <div className="shrink-0 px-5 py-4 border-t border-border bg-bg-raised h-28 flex flex-col justify-center">
          <ResourceBar metrics={resources?.metrics ?? null} stale={resources?.stale ?? true} />
        </div></>}
      </aside>

      {/* Right Pane */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg">
        {isOnboarding && !accountSettingsOpen ? (
          <OnboardingContent />
        ) : orgSettingsOpen ? (
          <OrgSettingsPanel onClose={() => navigate(projectId ? `/${projectId}` : "/")} />
        ) : accountSettingsOpen ? (
          <AccountSettingsPanel onClose={() => navigate(projectId ? `/${projectId}` : "/")} />
        ) : settingsOpen ? (
          <ProjectSettingsPanel
            initialSection={section}
            initialWorkflowBuilderTarget={workflowBuilderTarget}
            startInCreateMode={createProjectMode}
            onClose={closeSettings}
            onSwitchProject={switchProject}
            onNavigateWorkflow={projectId ? (id) => navigate(`/${projectId}/settings/workflows/${id ?? "new"}`) : undefined}
            onCloseWorkflow={projectId ? () => navigate(`/${projectId}/settings/workflows`) : undefined}
          />
        ) : noProjects ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs">
              <p className="text-[14px] font-semibold text-text-primary mb-2">No projects yet</p>
              <p className="text-[13px] text-text-muted">
                Create a project to start running issues in this organization.
              </p>
            </div>
          </div>
        ) : selectedIssue ? (
          <IssueErrorBoundary taskId={selectedIssue.task_id} onDismiss={() => selectIssue(null)}>
            <IssueDetail
              issue={selectedIssue}
              onOpenTerminal={handleOpenTerminal}
              onChangeTerminal={(id) => setTerminalPickerIssueId(id)}
              initialStep={stepSlug}
              onStepChange={(slug) => navigate(`/${projectId}/tasks/${selectedIssue.task_id}/${slug}`)}
            />
          </IssueErrorBoundary>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-[14px] text-text-muted">Select a task or add new ones</p>
              <div className="flex items-center justify-center gap-4 mt-3 text-[11px] text-text-faint">
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-bg-surface border border-border font-mono text-[10px]">j</kbd>
                  <span className="mx-0.5">/</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-bg-surface border border-border font-mono text-[10px]">k</kbd>
                  <span className="ml-1.5">navigate</span>
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-bg-surface border border-border font-mono text-[10px]">Enter</kbd>
                  <span className="ml-1.5">select</span>
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-bg-surface border border-border font-mono text-[10px]">n</kbd>
                  <span className="ml-1.5">new task</span>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Terminal picker modal */}
      {terminalPickerIssueId !== null && (
        <TerminalPicker
          onConfirm={handleTerminalPicked}
          onCancel={() => setTerminalPickerIssueId(null)}
        />
      )}
      <OnboardingOverlay />
      <OnboardingDevTools />
    </div>
  );
}

class IssueErrorBoundary extends Component<
  { taskId: number; onDismiss: () => void; children: ReactNode },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  componentDidUpdate(prevProps: { taskId: number }) {
    if (prevProps.taskId !== this.props.taskId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md w-full mx-6 p-5 rounded-xl border border-err/30 bg-err-bg">
            <p className="text-[13px] font-semibold text-err mb-1">Failed to render task #{this.props.taskId}</p>
            <p className="text-[12px] text-text-muted font-mono break-all mb-4">{this.state.error.message}</p>
            <button
              className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium border border-border text-text-primary hover:bg-bg-surface cursor-pointer transition-colors"
              onClick={this.props.onDismiss}
            >
              Dismiss
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}


function NotCompatible() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-6">
      <div className="text-center max-w-xs">
        <p className="text-[28px] mb-3">🖥️</p>
        <h1 className="text-[16px] font-semibold text-text-primary mb-2">Desktop only</h1>
        <p className="text-[13px] text-text-muted leading-relaxed">
          This dashboard is designed for desktop use. Open it on a laptop or desktop browser for the best experience.
        </p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <div className="block lg:hidden h-screen">
        <Routes>
          <Route path="/signin" element={<LoginPage />} />
          <Route path="/signup" element={<RegisterPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/auth/device" element={<DeviceAuthPage />} />
          <Route path="/auth/verify" element={<VerifyEmailPage />} />
          <Route path="/auth/verify-email-change" element={<VerifyEmailChangePage />} />
          <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<NotCompatible />} />
        </Routes>
      </div>
      <div className="hidden lg:block h-screen">
        <Routes>
          <Route path="/signin" element={<LoginPage />} />
          <Route path="/signup" element={<RegisterPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/auth/device" element={<DeviceAuthPage />} />
          <Route path="/auth/verify" element={<VerifyEmailPage />} />
          <Route path="/auth/verify-email-change" element={<VerifyEmailChangePage />} />
          <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/settings/new-project" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/org/settings" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/account/settings" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/:projectId" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/:projectId/tasks/:taskId" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/:projectId/tasks/:taskId/:stepSlug" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/:projectId/settings" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/:projectId/settings/:section" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/:projectId/settings/workflows/new" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
          <Route path="/:projectId/settings/workflows/:workflowId" element={<RequireAuth><Suspense fallback={<div className="h-screen bg-bg" />}><Dashboard /></Suspense></RequireAuth>} />
        </Routes>
      </div>
    </ToastProvider>
  );
}
