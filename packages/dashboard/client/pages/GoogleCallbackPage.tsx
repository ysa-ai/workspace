import { useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router";
import { setTokens } from "../lib/auth";
import { useAuth } from "../AuthProvider";
import { AuthShell } from "./AuthShell";
import { track } from "../lib/analytics";

export function GoogleCallbackPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [searchParams] = useSearchParams();

  const access = searchParams.get("access");
  const refresh = searchParams.get("refresh");
  const error = searchParams.get("error");

  const isNew = searchParams.get("new") === "1";

  useEffect(() => {
    if (access && refresh) {
      if (isNew) {
        track("signup_completed", { method: "google" });
        track("email_verified");
      }
      setTokens(access, refresh);
      login();
      navigate("/", { replace: true });
    }
  }, [access, refresh, isNew, login, navigate]);

  if (error || (!access && !refresh)) {
    return (
      <AuthShell>
        <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Authentication failed</h1>
        <p className="text-[13px] text-text-muted mt-3 leading-relaxed">
          Something went wrong with Google sign-in. Please try again.
        </p>
        <Link
          to="/signin"
          className="mt-5 block w-full py-2 text-center bg-primary-subtle border border-primary/30 rounded-lg text-[13px] font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p className="text-[13px] text-text-muted text-center">Signing you in…</p>
    </AuthShell>
  );
}
