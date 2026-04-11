import { useEffect, useState } from "react";

import { useSearchParams, useNavigate } from "react-router";
import { setTokens } from "../lib/auth";
import { useAuth } from "../AuthProvider";
import { AuthShell } from "./AuthShell";
import { track } from "../lib/analytics";

type Result = { status: "success" | "error"; error?: string; accessToken?: string; refreshToken?: string };
const promises = new Map<string, Promise<Result>>();

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Invalid verification link.");
      return;
    }

    let ignore = false;

    let promise = promises.get(token);
    if (!promise) {
      promise = fetch(`/auth/verify?token=${encodeURIComponent(token)}`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) return { status: "error" as const, error: data.error || "Verification failed." };
          return { status: "success" as const, accessToken: data.accessToken, refreshToken: data.refreshToken };
        })
        .catch(() => ({ status: "error" as const, error: "Network error." }));
      promises.set(token, promise);
    }

    promise.then((result) => {
      if (ignore) return;
      if (result.error) setError(result.error);
      if (result.status === "success" && result.accessToken) {
        track("email_verified");
        setTokens(result.accessToken, result.refreshToken!);
        login();
        setTimeout(() => navigate("/"), 1500);
      }
      setStatus(result.status);
    });

    return () => { ignore = true; };
  }, [token]);

  return (
    <AuthShell>
      {status === "loading" && (
        <p className="text-[13px] text-text-muted">Verifying your email…</p>
      )}
      {status === "success" && (
        <>
          <h1 className="text-[17px] font-semibold text-text-primary mb-2">Email verified</h1>
          <p className="text-[13px] text-text-muted">Redirecting to your dashboard…</p>
        </>
      )}
      {status === "error" && (
        <>
          <h1 className="text-[17px] font-semibold text-err mb-2">Verification failed</h1>
          <p className="text-[13px] text-text-muted">{error}</p>
          <p className="mt-4 text-center text-[12px] text-text-muted">
            <a href="/signin" className="text-text-secondary hover:text-text-primary font-medium">Back to sign in</a>
          </p>
        </>
      )}
    </AuthShell>
  );
}
