import { useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "../AuthProvider";
import { setTokens, getAccessToken } from "../lib/auth";
import { AuthShell } from "./AuthShell";

export function DeviceAuthPage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const { user, login } = useAuth();

  const [done, setDone] = useState<"authorized" | "denied" | null>(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  if (!code) {
    return (
      <AuthShell>
        <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Invalid link</h1>
        <p className="text-[13px] text-text-muted">This authorization link is missing a code.</p>
      </AuthShell>
    );
  }

  if (done === "authorized") {
    return (
      <AuthShell>
        <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Agent authorized</h1>
        <p className="text-[13px] text-text-muted">You can close this tab.</p>
      </AuthShell>
    );
  }

  if (done === "denied") {
    return (
      <AuthShell>
        <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Authorization cancelled</h1>
        <p className="text-[13px] text-text-muted">The agent was not authorized.</p>
      </AuthShell>
    );
  }

  async function handleApprove() {
    setApproving(true);
    setError("");
    try {
      const res = await fetch("/auth/device/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAccessToken()}`,
        },
        body: JSON.stringify({ user_code: code }),
      });
      if (res.ok) {
        setDone("authorized");
      } else {
        const data = await res.json();
        setError(data.error || "Authorization failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setApproving(false);
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const endpoint = authMode === "login" ? "/auth/login" : "/auth/register";
      const body = authMode === "login"
        ? { email, password }
        : { email, password, orgName };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || "Authentication failed"); return; }
      setTokens(data.accessToken, data.refreshToken);
      login();
    } catch {
      setAuthError("Network error");
    } finally {
      setAuthLoading(false);
    }
  }

  if (!user) {
    return (
      <AuthShell>
        <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Sign in to authorize</h1>
        <p className="text-[13px] text-text-muted mb-6">Sign in to authorize ysa-agent on your machine.</p>

        {authError && (
          <div className="mb-4 px-3.5 py-2.5 bg-err-bg border border-err/30 rounded-lg text-[13px] text-err flex items-center gap-2">
            <span className="opacity-70">⚠</span>{authError}
          </div>
        )}

        <form onSubmit={handleAuth} className="flex flex-col gap-3">
          {authMode === "register" && (
            <div>
              <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">
                Organization name
              </label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Corp"
                required
                className="w-full px-3 py-2 bg-bg-inset border border-border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
              />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-3 py-2 bg-bg-inset border border-border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={authMode === "register" ? 8 : undefined}
              className="w-full px-3 py-2 bg-bg-inset border border-border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={authLoading}
            className="mt-1 w-full py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[13px] font-medium text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {authLoading
              ? (authMode === "login" ? "Signing in…" : "Creating account…")
              : (authMode === "login" ? "Sign in" : "Create account")}
          </button>
        </form>

        <p className="mt-5 pt-5 border-t border-border text-center text-[12px] text-text-muted">
          {authMode === "login" ? (
            <>No account?{" "}
              <button onClick={() => setAuthMode("register")} className="text-text-secondary hover:text-text-primary transition-colors font-medium cursor-pointer">
                Create one
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button onClick={() => setAuthMode("login")} className="text-text-secondary hover:text-text-primary transition-colors font-medium cursor-pointer">
                Sign in
              </button>
            </>
          )}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Authorize ysa-agent?</h1>
      <p className="text-[13px] text-text-muted mb-6">
        Allow the agent running on your machine to connect to this dashboard as{" "}
        <span className="font-medium text-text-primary">{user.email}</span>.
      </p>

      {error && (
        <div className="mb-4 px-3.5 py-2.5 bg-err-bg border border-err/30 rounded-lg text-[13px] text-err flex items-center gap-2">
          <span className="opacity-70">⚠</span>{error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          onClick={handleApprove}
          disabled={approving}
          className="w-full py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[13px] font-medium text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {approving ? "Authorizing…" : "Authorize"}
        </button>
        <button
          onClick={() => setDone("denied")}
          disabled={approving}
          className="w-full py-2 border border-border rounded-lg text-[13px] font-medium text-text-muted hover:bg-bg-surface transition-colors disabled:opacity-50 cursor-pointer"
        >
          Deny
        </button>
      </div>
    </AuthShell>
  );
}
