import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { trpc } from "../trpc";
import { useAuth } from "../AuthProvider";

const DEMO_REPO = "https://github.com/ysa-ai/sandbox-demo";
const MAC_CMDS = ["brew install ysa-ai/tap/ysa-agent", "ysa-agent start"];
const LINUX_CMDS = ["curl -fsSL https://get.ysa.ai/agent | sh", "ysa-agent start"];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-[11px] font-medium text-text-faint hover:text-text-muted transition-colors cursor-pointer"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <div className="relative rounded-xl bg-[#0d0d0d] border border-white/8 p-4 mt-3">
      <div className="absolute top-3 right-3"><CopyBtn text={lines.join("\n")} /></div>
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="text-text-faint/40 select-none text-[12px] font-mono">$</span>
            <span className="font-mono text-[13px] text-text-primary">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OnboardingAccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-surface transition-colors cursor-pointer"
      >
        <span className="text-[12px] text-text-muted truncate max-w-[160px]">{user?.email}</span>
        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-text-faint shrink-0">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-44 bg-bg-surface border border-border rounded-lg shadow-lg z-50 py-1">
          <button
            onClick={() => { setOpen(false); navigate("/account/settings"); }}
            className="flex items-center w-full text-left px-3 py-2 text-[12px] text-text-muted hover:bg-bg-inset hover:text-text-primary transition-colors cursor-pointer"
          >
            Account settings
          </button>
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="flex items-center w-full text-left px-3 py-2 text-[12px] text-text-muted hover:bg-bg-inset hover:text-text-primary transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

type Sub = "install" | "waiting" | "provider" | "sandbox";
type Provider = "claude" | "mistral";
type ClaudeAuth = "oauth" | "apikey";

export function OnboardingContent() {
  const { updateOnboardingStep } = useAuth();
  const navigate = useNavigate();
  const [os, setOs] = useState<"mac" | "linux">(() =>
    navigator.userAgent.toLowerCase().includes("mac") ? "mac" : "linux"
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const sub: Sub = (searchParams.get("sub") as Sub) || "install";
  const setSub = (s: Sub) => setSearchParams(s === "install" ? {} : { sub: s }, { replace: true });
  const [provider, setProvider] = useState<Provider>("claude");
  const [claudeAuth, setClaudeAuth] = useState<ClaudeAuth>("oauth");
  const [apiKey, setApiKey] = useState("");
  const [dir, setDir] = useState("~/ysa-sandbox");
  const [setupError, setSetupError] = useState("");

  const { data: connected } = trpc.system.agentConnected.useQuery(undefined, {
    refetchInterval: sub === "install" || sub === "waiting" ? 3000 : false,
  });

  useEffect(() => {
    if (connected && (sub === "install" || sub === "waiting")) setSub("provider");
  }, [connected, sub]);

  const pickDirMutation = trpc.system.pickDirectory.useMutation({
    onSuccess: (data) => { if (data.path) setDir(data.path); },
  });

  const cloneMutation = trpc.system.cloneSandbox.useMutation();
  const setupMutation = trpc.actions.setupSandbox.useMutation();

  const isPending = cloneMutation.isPending || setupMutation.isPending;
  const progressLabel = cloneMutation.isPending ? "Cloning repo…" : setupMutation.isPending ? "Creating project…" : "";

  const needsApiKey = provider === "mistral" || (provider === "claude" && claudeAuth === "apikey");
  const canProceedProvider = !needsApiKey || apiKey.trim().length > 0;

  const handleSetup = async () => {
    if (!dir.trim() || isPending) return;
    setSetupError("");
    try {
      await cloneMutation.mutateAsync({ directory: dir, repoUrl: DEMO_REPO });
      const { projectId } = await setupMutation.mutateAsync({
        directory: dir,
        llmProvider: provider,
      });
      await updateOnboardingStep(2);
      localStorage.setItem("onboarding_sandbox_project_id", projectId);
      navigate(`/${projectId}`);
    } catch (e: any) {
      setSetupError(e.message || "Setup failed");
    }
  };

  const STEPS: Sub[] = ["install", "provider", "sandbox"];
  const stepIndex = sub === "waiting" ? 0 : STEPS.indexOf(sub);

  return (
    <div className="flex-1 flex items-center justify-center px-8 py-12 overflow-y-auto">
      <div className="w-full max-w-[500px]">

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-8">
          {(["install", "provider", "sandbox"] as const).map((s, i) => {
            const done = stepIndex > i;
            const active = stepIndex === i;
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="w-8 h-px bg-border" />}
                <div className={`flex items-center gap-1.5 text-[12px] font-medium ${active ? "text-text-primary" : done ? "text-ok" : "text-text-faint"}`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${active ? "bg-primary text-white" : done ? "bg-ok/20 text-ok" : "bg-bg-surface text-text-faint"}`}>
                    {done ? "✓" : i + 1}
                  </span>
                  {s === "install" ? "Install" : s === "provider" ? "Provider" : "Try it"}
                </div>
              </div>
            );
          })}
        </div>

        {/* Heading */}
        <h1 className="text-[24px] font-semibold text-text-primary leading-tight tracking-tight mb-1.5">
          {(sub === "install" || sub === "waiting") && "Set up the agent"}
          {sub === "provider" && "Choose your AI provider"}
          {sub === "sandbox" && "Set up a sandbox"}
        </h1>
        <p className="text-[13px] text-text-muted mb-7">
          {sub === "install" && "The agent runs on your machine and executes tasks inside containers."}
          {sub === "waiting" && "The agent connects via WebSocket once it starts."}
          {sub === "provider" && "This is used to run the demo task on your machine."}
          {sub === "sandbox" && "We'll clone a small demo repo so you can see the agent work."}
        </p>

        {/* Install */}
        {sub === "install" && (
          <div className="space-y-5">
            <div className="flex gap-1.5">
              {(["mac", "linux"] as const).map((o) => (
                <button key={o} onClick={() => setOs(o)}
                  className={`px-3 py-1 rounded-md text-[12px] font-medium border cursor-pointer transition-all ${
                    os === o ? "border-primary/40 bg-primary-subtle text-primary" : "border-border text-text-faint hover:text-text-muted"
                  }`}
                >
                  {o === "mac" ? "macOS" : "Linux"}
                </button>
              ))}
            </div>
            <CodeBlock lines={os === "mac" ? MAC_CMDS : LINUX_CMDS} />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setSub("waiting")}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
              >
                I ran the commands
              </button>
              <button onClick={() => setSub("waiting")}
                className="px-4 py-2.5 border border-border text-[13px] text-text-muted rounded-lg hover:bg-bg-surface cursor-pointer transition-colors"
              >
                Already installed
              </button>
            </div>
          </div>
        )}

        {/* Waiting */}
        {sub === "waiting" && (
          <div className="rounded-xl border border-border bg-bg-raised p-5 space-y-3">
            <div className="flex items-center gap-2 text-[13px]">
              {connected ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-ok shrink-0" />
                  <span className="text-ok font-medium">Agent connected</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                  <span className="text-text-muted">Waiting for connection…</span>
                </>
              )}
            </div>
            {!connected && (
              <div className="font-mono text-[12px] text-text-faint bg-bg-inset border border-border rounded-lg px-3 py-2">
                ysa-agent start
              </div>
            )}
          </div>
        )}

        {/* Provider */}
        {sub === "provider" && (
          <div className="space-y-5">
            {/* Provider toggle */}
            <div className="flex gap-2">
              {(["claude", "mistral"] as const).map((p) => (
                <button key={p} onClick={() => setProvider(p)}
                  className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium border cursor-pointer transition-all ${
                    provider === p ? "border-primary/40 bg-primary-subtle text-primary" : "border-border text-text-muted hover:bg-bg-surface"
                  }`}
                >
                  {p === "claude" ? "Claude" : "Mistral"}
                </button>
              ))}
            </div>

            {/* Claude auth method */}
            {provider === "claude" && (
              <div className="space-y-2">
                {(["oauth", "apikey"] as const).map((m) => (
                  <button key={m} onClick={() => setClaudeAuth(m)}
                    className={`w-full flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all text-left ${
                      claudeAuth === m ? "border-primary/40 bg-primary-subtle" : "border-border hover:bg-bg-surface"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${claudeAuth === m ? "border-primary" : "border-border"}`}>
                      {claudeAuth === m && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <div className={`text-[13px] font-medium ${claudeAuth === m ? "text-primary" : "text-text-primary"}`}>
                        {m === "oauth" ? "Claude login (OAuth)" : "Anthropic API key"}
                      </div>
                      <div className="text-[12px] text-text-muted mt-0.5">
                        {m === "oauth" ? "Use your existing Claude login — run claude /login first if you haven't" : "Enter your Anthropic API key"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* API key input */}
            {needsApiKey && (
              <input
                type="password"
                className="w-full bg-bg-inset border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-primary/50 transition-colors"
                placeholder={provider === "mistral" ? "Mistral API key" : "sk-ant-..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            )}

            <button
              onClick={() => setSub("sandbox")}
              disabled={!canProceedProvider}
              className="w-full py-2.5 bg-primary text-white rounded-lg text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        )}

        {/* Sandbox */}
        {sub === "sandbox" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                className="flex-1 bg-bg-inset border border-border rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
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
              <div className="flex items-center gap-2.5 text-[13px] text-text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {progressLabel}
              </div>
            ) : (
              <button onClick={handleSetup}
                className="w-full py-2.5 bg-primary text-white rounded-lg text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
              >
                Set up sandbox
              </button>
            )}
            {setupError && <div className="text-[12px] text-err">{setupError}</div>}
          </div>
        )}

      </div>
    </div>
  );
}
