import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "react-router";
import { AuthShell } from "./AuthShell";
import { useState } from "react";

const schema = z.object({
  email: z.string().email("Invalid email address"),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    await fetch("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell>
        <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Check your email</h1>
        <p className="text-[13px] text-text-muted mt-3 leading-relaxed">
          If an account exists for that email address, we sent a password reset link. Check your inbox.
        </p>
        <p className="mt-5 pt-5 border-t border-border text-center text-[12px] text-text-muted">
          <Link to="/signin" className="text-text-secondary hover:text-text-primary transition-colors font-medium">Back to sign in</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-[17px] font-semibold text-text-primary mb-1 tracking-tight">Reset password</h1>
      <p className="text-[13px] text-text-muted mb-6">Enter your email to receive a reset link</p>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-1 w-full py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[13px] font-medium text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="mt-5 pt-5 border-t border-border text-center text-[12px] text-text-muted">
        <Link to="/signin" className="text-text-secondary hover:text-text-primary transition-colors font-medium">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
