import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { trpc } from "../trpc";
import { useAuth } from "../AuthProvider";
import { OnboardingStep1 } from "./OnboardingStep1";
import { OnboardingStep2 } from "./OnboardingStep2";
import { track } from "../lib/analytics";

export const DEMO_PROMPT = "Fix the bug in `src/calculator.js` — `divide(10, -2)` throws but should return `-5`. Only a zero divisor should be rejected.";
export const SANDBOX_PROJECT_KEY = "onboarding_sandbox_project_id";

function ModalCard({ step, total, onSkip, title, children }: {
  step: number; total: number; onSkip: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[9999]">
      <div className="bg-bg-raised border border-border rounded-2xl shadow-xl w-[480px] max-w-[90vw] p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all ${i + 1 <= step ? "w-6 bg-primary" : "w-4 bg-border"}`} />
            ))}
          </div>
          <button onClick={onSkip} className="text-[12px] text-text-faint hover:text-text-muted cursor-pointer">
            Skip setup
          </button>
        </div>
        <h2 className="text-[15px] font-semibold text-text-primary mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Step3Connect({ onSkip }: { onSkip: () => void }) {
  const navigate = useNavigate();
  const { updateOnboardingStep } = useAuth();
  const { data: projectsList = [] } = trpc.projects.list.useQuery(undefined, { refetchInterval: 3000 });
  const sandboxId = localStorage.getItem(SANDBOX_PROJECT_KEY);
  const hasRealProject = projectsList.some((p: any) => p.project_id !== sandboxId);

  const handleConnect = () => { onSkip(); navigate("/settings/new-project"); };

  if (hasRealProject) {
    return (
      <div className="text-center py-4">
        <div className="text-ok text-[14px] font-semibold mb-3">Project connected ✓</div>
        <button
          onClick={() => updateOnboardingStep(4)}
          className="px-4 py-2 bg-primary text-white rounded-lg text-[13px] font-medium hover:brightness-110 cursor-pointer"
        >
          Continue →
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="text-[13px] text-text-muted mb-4">
        You've seen it work. Now connect your own codebase to run tasks on real issues.
      </p>
      <button
        onClick={handleConnect}
        className="w-full py-2.5 bg-primary text-white rounded-lg text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer mb-3"
      >
        Connect a repository
      </button>
      <div className="text-center">
        <button onClick={onSkip} className="text-[12px] text-text-faint hover:text-text-muted cursor-pointer">
          I'll do this later
        </button>
      </div>
    </>
  );
}

const ROLES = ["Engineer", "Tech Lead", "CTO", "Other"];
const TEAM_SIZES = ["Solo", "2–10", "10+"];
const USE_CASES = ["Bug fixes", "Features", "Code review", "Other"];

function Step4Profile({ onDone }: { onDone: () => void }) {
  const { updateOnboardingProfile, completeOnboarding } = useAuth();
  const [role, setRole] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [useCase, setUseCase] = useState("");
  const [saving, setSaving] = useState(false);

  const handleDone = async () => {
    setSaving(true);
    await updateOnboardingProfile({ role: role || undefined, teamSize: teamSize || undefined, useCase: useCase || undefined });
    track("onboarding_completed", { skipped: false, role: role || undefined, teamSize: teamSize || undefined, useCase: useCase || undefined });
    await completeOnboarding();
    onDone();
  };

  return (
    <>
      <div className="space-y-4 mb-5">
        {[
          { label: "Your role", options: ROLES, value: role, set: setRole },
          { label: "Team size", options: TEAM_SIZES, value: teamSize, set: setTeamSize },
          { label: "Primary use case", options: USE_CASES, value: useCase, set: setUseCase },
        ].map(({ label, options, value, set }) => (
          <div key={label}>
            <div className="text-[12px] text-text-muted font-medium mb-2">{label}</div>
            <div className="flex flex-wrap gap-2">
              {options.map((opt) => (
                <button key={opt} onClick={() => set(opt === value ? "" : opt)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] border cursor-pointer transition-all ${
                    value === opt ? "border-primary/50 bg-primary-subtle text-primary" : "border-border text-text-muted hover:bg-bg-surface"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button onClick={handleDone} disabled={saving}
        className="w-full py-2.5 bg-primary text-white rounded-lg text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
      >
        {saving ? "Saving…" : "Done — start building"}
      </button>
    </>
  );
}

export function OnboardingOverlay() {
  const { user, completeOnboarding, updateOnboardingStep } = useAuth();
  const navigate = useNavigate();
  const [sandboxProjectId, setSandboxProjectId] = useState<string | null>(
    () => localStorage.getItem(SANDBOX_PROJECT_KEY)
  );
  useEffect(() => {
    setSandboxProjectId(localStorage.getItem(SANDBOX_PROJECT_KEY));
  }, [user?.onboardingStep]);

  useEffect(() => {
    if (user && user.onboardingCompletedAt === null) {
      track("onboarding_step_viewed", { step: user.onboardingStep });
    }
  }, [user?.onboardingStep]);

  if (!user || user.onboardingCompletedAt !== null) return null;

  const step = user.onboardingStep;
  const skip = () => { track("onboarding_completed", { skipped: true, last_step: step }); completeOnboarding(); };

  if (step === 2 && sandboxProjectId) {
    return (
      <OnboardingStep2
        projectId={sandboxProjectId}
        onComplete={() => {}}
        onSkip={skip}
      />
    );
  }

  if (step === 3) {
    return (
      <ModalCard step={3} total={4} onSkip={skip} title="Connect your repository">
        <Step3Connect onSkip={skip} />
      </ModalCard>
    );
  }

  if (step === 4) {
    return (
      <ModalCard step={4} total={4} onSkip={skip} title="Quick profile">
        <Step4Profile onDone={() => {}} />
      </ModalCard>
    );
  }

  return null;
}

export function OnboardingDevTools() {
  if (!import.meta.env.DEV) return null;
  const { user, updateOnboardingStep, resetOnboarding } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ob_devtools_collapsed") === "1");
  if (!user) return null;

  const step = user.onboardingCompletedAt !== null ? "done" : user.onboardingStep;
  const sandboxId = localStorage.getItem(SANDBOX_PROJECT_KEY);

  const STEPS = [
    { label: "install",   action: () => { updateOnboardingStep(0); navigate("/?sub=install"); } },
    { label: "provider",  action: () => { updateOnboardingStep(0); navigate("/?sub=provider"); } },
    { label: "sandbox",   action: () => { updateOnboardingStep(0); navigate("/?sub=sandbox"); } },
    { label: "run",       action: () => { updateOnboardingStep(2); if (sandboxId) navigate(`/${sandboxId}`); } },
    { label: "connect",   action: () => updateOnboardingStep(3) },
    { label: "profile",   action: () => updateOnboardingStep(4) },
  ];

  if (collapsed) {
    return (
      <div className="fixed bottom-4 right-4 z-[99999] bg-bg-raised border border-border rounded-lg shadow-lg">
        <button
          onClick={() => { localStorage.removeItem("ob_devtools_collapsed"); setCollapsed(false); }}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-faint hover:text-text-primary cursor-pointer"
        >
          <span className="font-mono">ob:{step}</span>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[99999] flex items-center gap-1 bg-bg-raised border border-border rounded-lg px-2 py-1.5 shadow-lg text-[11px] text-text-faint">
      <span className="mr-1 font-mono">ob:{step}</span>
      {STEPS.map(({ label, action }) => (
        <button key={label} onClick={action} className="px-1.5 py-0.5 rounded hover:bg-bg-surface cursor-pointer">
          {label}
        </button>
      ))}
      <button onClick={resetOnboarding} className="ml-1 px-1.5 py-0.5 rounded hover:bg-bg-surface cursor-pointer">↺</button>
      <button onClick={() => { localStorage.setItem("ob_devtools_collapsed", "1"); setCollapsed(true); }} className="ml-1 px-1.5 py-0.5 rounded hover:bg-bg-surface cursor-pointer" title="Collapse">
        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

export function SandboxBanner({ projectId }: { projectId: string | null }) {
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem("sandbox_banner_dismissed"));
  const { user } = useAuth();
  const sandboxId = localStorage.getItem(SANDBOX_PROJECT_KEY);

  if (dismissed || !sandboxId || projectId !== sandboxId) return null;
  if (!user || user.onboardingStep < 2) return null;

  return (
    <div className="shrink-0 mx-4 my-2 px-3.5 py-2.5 bg-primary-subtle border border-primary/20 rounded-lg flex items-center justify-between gap-2">
      <span className="text-[12px] text-primary">You're exploring the sandbox. Each additional run uses your API tokens.</span>
      <button
        onClick={() => { localStorage.setItem("sandbox_banner_dismissed", "1"); setDismissed(true); }}
        className="shrink-0 text-primary/60 hover:text-primary cursor-pointer"
      >
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

export function SkipBanner() {
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem("skip_banner_dismissed"));
  const { user } = useAuth();
  const navigate = useNavigate();

  if (dismissed || !user) return null;
  if (!user.onboardingCompletedAt || user.onboardingStep >= 3) return null;

  return (
    <div className="shrink-0 mx-4 my-2 px-3.5 py-2.5 bg-bg-surface border border-border rounded-lg flex items-center justify-between gap-2">
      <button onClick={() => navigate("/settings/new-project")} className="text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer">
        Connect your repo to run tasks on your own code →
      </button>
      <button
        onClick={() => { localStorage.setItem("skip_banner_dismissed", "1"); setDismissed(true); }}
        className="shrink-0 text-text-faint hover:text-text-muted cursor-pointer"
      >
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
