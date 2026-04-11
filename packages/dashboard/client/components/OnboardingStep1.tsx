import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import { useAuth } from "../AuthProvider";

const DEMO_REPO = "https://github.com/ysa-ai/sandbox-demo";
const MAC_CMDS = ["brew install ysa-ai/tap/ysa-agent", "ysa-agent start"];
const LINUX_CMDS = ["curl -fsSL https://get.ysa.ai/agent | sh", "ysa-agent start"];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-[11px] text-text-faint hover:text-text-muted cursor-pointer"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <div className="relative bg-bg-inset border border-border rounded-lg p-3.5 mt-2">
      <div className="absolute top-2.5 right-2.5"><CopyBtn text={lines.join("\n")} /></div>
      {lines.map((l, i) => <div key={i} className="font-mono text-[12px] text-text-primary">{l}</div>)}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 shrink-0 text-text-faint" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export function OnboardingStep1({ onComplete, onSkip }: { onComplete: (projectId: string) => void; onSkip: () => void }) {
  const { updateOnboardingStep } = useAuth();
  const [os, setOs] = useState<"mac" | "linux">(() =>
    navigator.userAgent.toLowerCase().includes("mac") ? "mac" : "linux"
  );
  const [sub, setSub] = useState<"install" | "waiting" | "sandbox">("install");
  const [dir, setDir] = useState("~/ysa-sandbox");
  const [setupError, setSetupError] = useState("");

  const { data: connected } = trpc.system.agentConnected.useQuery(undefined, {
    refetchInterval: sub === "waiting" ? 3000 : false,
  });

  useEffect(() => {
    if (sub === "waiting" && connected) setSub("sandbox");
  }, [connected, sub]);

  const pickDirMutation = trpc.system.pickDirectory.useMutation({
    onSuccess: (data) => { if (data.path) setDir(data.path); },
    onError: (e) => setSetupError(e.message || "Failed to open directory picker"),
  });

  const cloneMutation = trpc.system.cloneSandbox.useMutation();
  const setupMutation = trpc.actions.setupSandbox.useMutation();

  const isPending = cloneMutation.isPending || setupMutation.isPending;

  const progressLabel = cloneMutation.isPending ? "Cloning demo repo…"
    : setupMutation.isPending ? "Creating sandbox project…"
    : "";

  const handleSetup = async () => {
    if (!dir.trim() || isPending) return;
    setSetupError("");
    try {
      await cloneMutation.mutateAsync({ directory: dir, repoUrl: DEMO_REPO });
      const { projectId } = await setupMutation.mutateAsync({ directory: dir });
      await updateOnboardingStep(2);
      localStorage.setItem("onboarding_sandbox_project_id", projectId);
      onComplete(projectId);
    } catch (e: any) {
      setSetupError(e.message || "Setup failed");
    }
  };

  return (
    <div>
      {sub === "install" && (
        <>
          <div className="flex gap-2 mb-4">
            {(["mac", "linux"] as const).map((o) => (
              <button key={o} onClick={() => setOs(o)}
                className={`px-3 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-all ${os === o ? "border-primary/40 bg-primary-subtle text-primary" : "border-border text-text-faint hover:text-text-muted"}`}
              >
                {o === "mac" ? "macOS" : "Linux"}
              </button>
            ))}
          </div>
          <div className="text-[13px] text-text-muted mb-1">Install and start the agent:</div>
          <CodeBlock lines={os === "mac" ? MAC_CMDS : LINUX_CMDS} />
          <div className="mt-4 flex gap-2">
            <button onClick={() => setSub("waiting")}
              className="flex-1 py-2 bg-primary text-white rounded-lg text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
            >
              I ran the commands
            </button>
            <button onClick={() => setSub("waiting")}
              className="px-3 py-2 border border-border text-[12px] text-text-muted rounded-lg hover:bg-bg-surface cursor-pointer transition-colors"
            >
              Already installed
            </button>
          </div>
        </>
      )}

      {sub === "waiting" && (
        <div className="text-center py-8">
          {connected ? (
            <div className="text-ok text-[14px] font-semibold">Agent connected ✓</div>
          ) : (
            <>
              <div className="flex justify-center mb-3"><Spinner /></div>
              <div className="text-[13px] text-text-muted">Waiting for agent connection…</div>
              <div className="text-[11px] text-text-faint mt-1.5">
                Make sure you ran <span className="font-mono bg-bg-inset px-1 rounded">ysa-agent start</span>
              </div>
            </>
          )}
        </div>
      )}

      {sub === "sandbox" && (
        <>
          <div className="text-[13px] text-text-muted mb-3">Where should we clone the sandbox repo?</div>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-primary/40"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="~/ysa-sandbox"
              disabled={isPending}
            />
            <button
              onClick={() => pickDirMutation.mutate()}
              disabled={isPending || pickDirMutation.isPending}
              className="px-3 py-2 border border-border rounded-lg text-[12px] text-text-muted hover:bg-bg-surface cursor-pointer transition-colors disabled:opacity-40"
            >
              Browse
            </button>
          </div>
          {isPending ? (
            <div className="flex items-center gap-2 text-[13px] text-text-muted py-1">
              <Spinner />{progressLabel}
            </div>
          ) : (
            <button onClick={handleSetup}
              className="w-full py-2 bg-primary text-white rounded-lg text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
            >
              Set up sandbox
            </button>
          )}
          {setupError && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[12px] text-err">{setupError}</span>
              <a href="https://github.com/ysa-ai/workspace/issues" target="_blank" rel="noopener noreferrer" className="text-[11px] text-text-faint hover:text-text-muted cursor-pointer shrink-0">
                Report issue
              </a>
            </div>
          )}
        </>
      )}

      <div className="mt-5 pt-4 border-t border-border-subtle">
        <button onClick={onSkip} className="text-[12px] text-text-faint hover:text-text-muted cursor-pointer">
          Skip setup
        </button>
      </div>
    </div>
  );
}
