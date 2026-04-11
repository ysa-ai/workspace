import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuthShell } from "./AuthShell";
import { useState } from "react";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").regex(/\d/, "Password must contain at least one number"),
  passwordConfirm: z.string(),
}).refine((d) => d.password === d.passwordConfirm, {
  message: "Passwords do not match",
  path: ["passwordConfirm"],
});

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [rootError, setRootError] = useState("");
  const token = searchParams.get("token");

  const { register, handleSubmit, watch, formState: { errors, isSubmitting, touchedFields } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
  });

  const password = watch("password");
  const passwordConfirm = watch("passwordConfirm");
  const confirmTouched = touchedFields.passwordConfirm;
  const confirmMismatch = confirmTouched && !!passwordConfirm && password !== passwordConfirm;
  const confirmMatch = confirmTouched && !!passwordConfirm && password === passwordConfirm;

  async function onSubmit(values: FormValues) {
    setRootError("");
    try {
      const res = await fetch("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: values.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRootError(data.error || "Reset failed");
        return;
      }
      navigate("/signin");
    } catch {
      setRootError("Network error");
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <p className="text-[13px] text-err">Invalid reset link.</p>
        <p className="mt-4 text-center text-[12px] text-text-muted">
          <Link to="/forgot-password" className="text-text-secondary hover:text-text-primary font-medium">Request a new one</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Set new password</h1>
      <p className="text-[13px] text-text-muted mb-6">Choose a new password for your account</p>

      {rootError && (
        <div className="mb-4 px-3.5 py-2.5 bg-err-bg border border-err/30 rounded-lg text-[13px] text-err flex items-center gap-2">
          <span className="opacity-70">⚠</span>{rootError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <label className="block text-[11px] font-medium text-text-muted uppercase tracking-widest mb-1.5 font-mono">New password <span className="text-err">*</span></label>
          <input
            type="password"
            placeholder="8+ characters, at least one number"
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
          disabled={isSubmitting}
          className="mt-1 w-full py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[13px] font-medium text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isSubmitting ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
