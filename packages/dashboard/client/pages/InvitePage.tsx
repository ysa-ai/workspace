import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { trpc } from "../trpc";
import { useAuth } from "../AuthProvider";
import { setTokens } from "../lib/auth";
import { AuthShell } from "./AuthShell";
import { track } from "../lib/analytics";

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, login, switchOrg } = useAuth();

  const { data: invite, isLoading } = trpc.auth.validateInvite.useQuery(
    { token: token! },
    { enabled: !!token, retry: false },
  );

  const acceptMutation = trpc.auth.acceptInvite.useMutation({
    onSuccess: async (data) => {
      track("invite_accepted");
      await switchOrg(data.orgId);
      navigate("/");
    },
  });

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(""); setAuthLoading(true);
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
      acceptMutation.mutate({ token: token! });
    } catch { setAuthError("Network error"); }
    finally { setAuthLoading(false); }
  }

  if (isLoading) {
    return (
      <AuthShell>
        <div className="h-24 flex items-center justify-center">
          <div className="text-[13px] text-text-muted">Loading…</div>
        </div>
      </AuthShell>
    );
  }

  if (!invite || (!invite.valid && !invite.expired && !invite.used)) {
    return (
      <AuthShell>
        <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Invalid invite</h1>
        <p className="text-[13px] text-text-muted">This invite link is not valid.</p>
      </AuthShell>
    );
  }

  if (invite.expired || invite.used) {
    return (
      <AuthShell>
        <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Invite unavailable</h1>
        <p className="text-[13px] text-text-muted">
          {invite.used
            ? "This invite link has already been used."
            : "This invite link has expired."}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">You've been invited</h1>
      <p className="text-[13px] text-text-muted mb-6">
        Join <span className="font-semibold text-text-primary">{invite.orgName}</span> as{" "}
        <span className="font-semibold text-text-primary">{invite.role}</span>
      </p>

      {acceptMutation.isError && (
        <div className="mb-4 px-3.5 py-2.5 bg-err-bg border border-err/30 rounded-lg text-[13px] text-err flex items-center gap-2">
          <span className="opacity-70">⚠</span>{acceptMutation.error.message}
        </div>
      )}

      {user ? (
        <div>
          <p className="text-[12px] text-text-muted mb-4">
            Signed in as <span className="font-medium text-text-primary">{user.email}</span>
          </p>
          <button
            onClick={() => acceptMutation.mutate({ token: token! })}
            disabled={acceptMutation.isPending}
            className="w-full py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[13px] font-medium text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {acceptMutation.isPending ? "Joining…" : `Join ${invite.orgName}`}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-[12px] text-text-muted mb-4">Sign in or create an account to accept this invitation.</p>

          {authError && (
            <div className="mb-4 px-3.5 py-2.5 bg-err-bg border border-err/30 rounded-lg text-[13px] text-err flex items-center gap-2">
              <span className="opacity-70">⚠</span>{authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="flex flex-col gap-3">
            {authMode === "register" && (
              <div>
                <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">
                  Your organization name
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
        </div>
      )}
    </AuthShell>
  );
}
