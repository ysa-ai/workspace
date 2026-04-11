import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, Navigate } from "react-router";
import { setTokens } from "../lib/auth";
import { useAuth } from "../AuthProvider";
import { AuthShell } from "./AuthShell";
import { track } from "../lib/analytics";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

const schema = z.object({
  orgName: z.string().min(1, "Organization name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").regex(/\d/, "Password must contain at least one number"),
  passwordConfirm: z.string(),
}).refine((d) => d.password === d.passwordConfirm, {
  message: "Passwords do not match",
  path: ["passwordConfirm"],
});

type FormValues = z.infer<typeof schema>;

const signupDisabled = import.meta.env.VITE_SIGNUP_DISABLED === "true";

export function RegisterPage() {
  const { user, isLoading, login } = useAuth();
  const navigate = useNavigate();

  const { register, handleSubmit, setError, watch, formState: { errors, isSubmitting, touchedFields, isValid } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
  });

  const password = watch("password");

  if (signupDisabled) return <Navigate to="/signin" replace />;
  if (!isLoading && user) return <Navigate to="/" replace />;
  const passwordConfirm = watch("passwordConfirm");

  async function onSubmit(values: FormValues) {
    try {
      const res = await fetch("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email, password: values.password, orgName: values.orgName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError("root", { message: data.error || "Registration failed" });
        return;
      }
      track("signup_completed", { method: "email" });
      setTokens(data.accessToken, data.refreshToken);
      login();
      navigate("/");
    } catch {
      setError("root", { message: "Network error" });
    }
  }

  const confirmTouched = touchedFields.passwordConfirm;
  const confirmMismatch = confirmTouched && !!passwordConfirm && password !== passwordConfirm;
  const confirmMatch = confirmTouched && !!passwordConfirm && password === passwordConfirm;

  return (
    <AuthShell>
      <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Create account</h1>
      <p className="text-[13px] text-text-muted mb-6">Start running issues in your workspace</p>

      {googleClientId && (
        <>
          <button
            type="button"
            onClick={() => { window.location.href = "/auth/google"; }}
            className="w-full flex items-center justify-center gap-2.5 py-2 bg-bg-inset border border-border rounded-lg text-[13px] font-medium text-text-primary hover:bg-bg-raised hover:border-text-faint transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Sign up with Google
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-text-faint uppercase tracking-widest font-mono">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>
        </>
      )}

      {errors.root && (
        <div className="mb-4 px-3.5 py-2.5 bg-err-bg border border-err/30 rounded-lg text-[13px] text-err flex items-center gap-2">
          <span className="opacity-70">⚠</span>{errors.root.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">Organization name <span className="text-err">*</span></label>
          <input
            type="text"
            placeholder="Acme Corp"
            {...register("orgName")}
            className={`w-full px-3 py-2 bg-bg-inset border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none transition-colors ${
              errors.orgName ? "border-err/60 focus:border-err focus:ring-1 focus:ring-err/20" : "border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
            }`}
          />
          {errors.orgName && <p className="mt-1.5 text-[11px] text-err">{errors.orgName.message}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">Email <span className="text-err">*</span></label>
          <input
            type="email"
            placeholder="you@example.com"
            {...register("email")}
            className={`w-full px-3 py-2 bg-bg-inset border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none transition-colors ${
              errors.email ? "border-err/60 focus:border-err focus:ring-1 focus:ring-err/20" : "border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
            }`}
          />
          {errors.email && <p className="mt-1.5 text-[11px] text-err">{errors.email.message}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">Password <span className="text-err">*</span></label>
          <input
            type="password"
            placeholder="8+ chars, at least one number"
            {...register("password")}
            className={`w-full px-3 py-2 bg-bg-inset border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none transition-colors ${
              errors.password ? "border-err/60 focus:border-err focus:ring-1 focus:ring-err/20" : "border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
            }`}
          />
          {errors.password && <p className="mt-1.5 text-[11px] text-err">{errors.password.message}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">Confirm password <span className="text-err">*</span></label>
          <input
            type="password"
            placeholder="Repeat your password"
            {...register("passwordConfirm")}
            className={`w-full px-3 py-2 bg-bg-inset border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none transition-colors ${
              confirmMismatch ? "border-err/60 focus:border-err focus:ring-1 focus:ring-err/20"
              : confirmMatch ? "border-ok/60 focus:border-ok focus:ring-1 focus:ring-ok/20"
              : "border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
            }`}
          />
          {confirmMismatch && <p className="mt-1.5 text-[11px] text-err">Passwords do not match</p>}
        </div>
        <button
          type="submit"
          disabled={isSubmitting || !isValid}
          className="mt-1 w-full py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[13px] font-medium text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-5 pt-5 border-t border-border text-center text-[12px] text-text-muted">
        Already have an account?{" "}
        <Link to="/signin" className="text-text-secondary hover:text-text-primary transition-colors font-medium">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
