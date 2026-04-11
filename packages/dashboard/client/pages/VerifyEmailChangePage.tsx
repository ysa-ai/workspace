import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { AuthShell } from "./AuthShell";

type Result = { status: "success" | "error"; error?: string };
const promises = new Map<string, Promise<Result>>();

export function VerifyEmailChangePage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setError("Invalid link.");
      setStatus("error");
      return;
    }

    let ignore = false;

    let promise = promises.get(token);
    if (!promise) {
      promise = fetch(`/auth/verify-email-change?token=${encodeURIComponent(token)}`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) return { status: "error" as const, error: data.error || "Verification failed." };
          return { status: "success" as const };
        })
        .catch(() => ({ status: "error" as const, error: "Network error." }));
      promises.set(token, promise);
    }

    promise.then((result) => {
      if (ignore) return;
      if (result.error) setError(result.error);
      setStatus(result.status);
    });

    return () => { ignore = true; };
  }, [token]);

  return (
    <AuthShell>
      {status === "loading" && (
        <p className="text-[13px] text-text-muted">Verifying your new email…</p>
      )}
      {status === "success" && (
        <>
          <h1 className="text-[17px] font-semibold text-text-primary mb-2">Email updated</h1>
          <p className="text-[13px] text-text-muted mb-5">Your email address has been changed successfully.</p>
          <a href="/app/account/settings" className="text-[13px] text-text-secondary hover:text-text-primary font-medium">Back to account settings</a>
        </>
      )}
      {status === "error" && (
        <>
          <h1 className="text-[17px] font-semibold text-err mb-2">Verification failed</h1>
          <p className="text-[13px] text-text-muted">{error}</p>
        </>
      )}
    </AuthShell>
  );
}
