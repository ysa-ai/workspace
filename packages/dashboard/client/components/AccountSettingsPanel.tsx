import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "../AuthProvider";
import { useNavigate } from "react-router";
import { trpc } from "../trpc";
import { useToast } from "./Toast";

interface Props {
  onClose: () => void;
}

const emailSchema = z.object({
  newEmail: z.string().email("Invalid email address"),
  currentPassword: z.string().min(1, "Current password is required"),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters").regex(/\d/, "Must contain at least one number"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type EmailFormValues = z.infer<typeof emailSchema>;
type PasswordFormValues = z.infer<typeof passwordSchema>;

const inputCls = (error?: boolean) =>
  `w-full px-3 py-2 bg-bg border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none transition-colors ${
    error ? "border-err/60 focus:border-err focus:ring-1 focus:ring-err/20" : "border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
  }`;

// ─── Profile section ──────────────────────────────────────────────────────────

function ProfileSection() {
  const { user, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm">("idle");
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);

  const changePasswordMutation = trpc.auth.changePassword.useMutation();
  const requestEmailChangeMutation = trpc.auth.requestEmailChange.useMutation();

  const emailForm = useForm<EmailFormValues>({ resolver: zodResolver(emailSchema), mode: "onTouched" });
  const passwordForm = useForm<PasswordFormValues>({ resolver: zodResolver(passwordSchema), mode: "onTouched" });

  async function onEmailSubmit(values: EmailFormValues) {
    try {
      await requestEmailChangeMutation.mutateAsync({ newEmail: values.newEmail, currentPassword: values.currentPassword });
      setEmailSent(true);
      emailForm.reset();
    } catch (err: any) {
      emailForm.setError("root", { message: err.message ?? "Failed to request email change" });
    }
  }

  async function onPasswordSubmit(values: PasswordFormValues) {
    try {
      await changePasswordMutation.mutateAsync({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      setPasswordDone(true);
      passwordForm.reset();
    } catch (err: any) {
      passwordForm.setError("root", { message: err.message ?? "Failed to update password" });
    }
  }

  async function handleDeleteAccount() {
    if (deleteInput !== user?.email) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteAccount();
      localStorage.removeItem("dashboard_active_project");
      navigate("/signup");
    } catch (err: any) {
      setDeleteError(err.message ?? "Failed to delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <h3 className="text-[13px] font-semibold text-text-primary mb-1">Account</h3>
        <p className="text-[13px] text-text-muted">{user?.email}</p>
      </section>

      <section>
        <h3 className="text-[13px] font-semibold text-text-primary mb-4">Change email</h3>
        {emailSent ? (
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-ok">Verification link sent — check your new inbox.</p>
            <button onClick={() => setEmailSent(false)} className="text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer">Change again</button>
          </div>
        ) : (
          <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="flex flex-col gap-3">
            {emailForm.formState.errors.root && <p className="text-[12px] text-err">{emailForm.formState.errors.root.message}</p>}
            <div>
              <input type="email" placeholder="New email address" {...emailForm.register("newEmail")} className={inputCls(!!emailForm.formState.errors.newEmail)} />
              {emailForm.formState.errors.newEmail && <p className="mt-1 text-[11px] text-err">{emailForm.formState.errors.newEmail.message}</p>}
            </div>
            <div>
              <input type="password" placeholder="Current password" {...emailForm.register("currentPassword")} className={inputCls(!!emailForm.formState.errors.currentPassword)} />
              {emailForm.formState.errors.currentPassword && <p className="mt-1 text-[11px] text-err">{emailForm.formState.errors.currentPassword.message}</p>}
            </div>
            <div>
              <button type="submit" disabled={requestEmailChangeMutation.isPending} className="px-4 py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[12px] font-medium text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50 cursor-pointer">
                {requestEmailChangeMutation.isPending ? "Sending…" : "Send verification link"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section>
        <h3 className="text-[13px] font-semibold text-text-primary mb-4">Change password</h3>
        {passwordDone ? (
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-ok">Password updated.</p>
            <button onClick={() => setPasswordDone(false)} className="text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer">Change again</button>
          </div>
        ) : (
          <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="flex flex-col gap-3">
            {passwordForm.formState.errors.root && <p className="text-[12px] text-err">{passwordForm.formState.errors.root.message}</p>}
            <div>
              <input type="password" placeholder="Current password" {...passwordForm.register("currentPassword")} className={inputCls(!!passwordForm.formState.errors.currentPassword)} />
              {passwordForm.formState.errors.currentPassword && <p className="mt-1 text-[11px] text-err">{passwordForm.formState.errors.currentPassword.message}</p>}
            </div>
            <div>
              <input type="password" placeholder="New password (8+ chars, at least one number)" {...passwordForm.register("newPassword")} className={inputCls(!!passwordForm.formState.errors.newPassword)} />
              {passwordForm.formState.errors.newPassword && <p className="mt-1 text-[11px] text-err">{passwordForm.formState.errors.newPassword.message}</p>}
            </div>
            <div>
              <input type="password" placeholder="Confirm new password" {...passwordForm.register("confirmPassword")} className={inputCls(!!passwordForm.formState.errors.confirmPassword)} />
              {passwordForm.formState.errors.confirmPassword && <p className="mt-1 text-[11px] text-err">{passwordForm.formState.errors.confirmPassword.message}</p>}
            </div>
            <div>
              <button type="submit" disabled={changePasswordMutation.isPending} className="px-4 py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[12px] font-medium text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50 cursor-pointer">
                {changePasswordMutation.isPending ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="border border-err/40 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-err/20 bg-err/5">
          <h3 className="text-[13px] font-semibold text-err">Danger Zone</h3>
        </div>
        <div className="px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium text-text-primary mb-1">Delete my account</p>
              <p className="text-[12px] text-text-muted leading-relaxed">
                Permanently deletes your account and removes you from all organizations.
                Organizations for which you are the sole owner will also be deleted. This action cannot be undone.
              </p>
            </div>
            {deleteStep === "idle" && (
              <button onClick={() => setDeleteStep("confirm")} className="shrink-0 px-3.5 py-1.5 rounded-lg border border-err/50 text-[12px] font-medium text-err hover:bg-err/10 transition-colors cursor-pointer">
                Delete account
              </button>
            )}
          </div>
          {deleteStep === "confirm" && (
            <div className="mt-5 pt-5 border-t border-border">
              <p className="text-[12px] text-text-muted mb-3">
                To confirm, type your email address <span className="font-semibold text-text-primary font-mono">{user?.email}</span> below:
              </p>
              <input
                autoFocus
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={user?.email}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-err transition-colors mb-3 font-mono"
              />
              {deleteError && <p className="mb-3 text-[12px] text-err">{deleteError}</p>}
              <div className="flex gap-2">
                <button onClick={handleDeleteAccount} disabled={deleting || deleteInput !== user?.email} className="px-4 py-2 bg-err text-white rounded-lg text-[12px] font-semibold hover:bg-err/80 transition-colors disabled:opacity-50 cursor-pointer">
                  {deleting ? "Deleting…" : "I understand, delete my account"}
                </button>
                <button onClick={() => { setDeleteStep("idle"); setDeleteInput(""); setDeleteError(""); }} className="px-4 py-2 rounded-lg border border-border text-[12px] text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Credentials section ──────────────────────────────────────────────────────

function CredentialsSection() {
  const showToast = useToast();
  const utils = trpc.useUtils();

  // Agent credentials (local, read-only from server perspective)
  const { data: agentData, isLoading: agentLoading, refetch: refetchAgent } = trpc.projects.listCredentials.useQuery(undefined, { refetchOnWindowFocus: false });
  const agentCredentials = agentData?.credentials ?? [];

  // Server credentials (access tokens)
  const { data: serverData, isLoading: serverLoading, refetch: refetchServer } = trpc.projects.listServerCredentials.useQuery(undefined, { refetchOnWindowFocus: false });
  const serverCredentials = serverData?.credentials ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addProvider, setAddProvider] = useState("gitlab");
  const [addValue, setAddValue] = useState("");

  const addMutation = trpc.projects.addServerCredential.useMutation({
    onSuccess: () => {
      utils.projects.listServerCredentials.invalidate();
      setAddOpen(false);
      setAddName("");
      setAddValue("");
      showToast("Credential added", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const removeMutation = trpc.projects.removeServerCredential.useMutation({
    onSuccess: () => {
      utils.projects.listServerCredentials.invalidate();
      showToast("Credential removed", "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const isLoading = agentLoading || serverLoading;
  const allEmpty = agentCredentials.length === 0 && serverCredentials.length === 0;

  return (
    <div className="space-y-6">
      <div className="p-3 rounded-lg bg-bg-inset border border-border text-[12px] text-text-muted">
        Credentials are stored securely and never exposed in logs. AI keys are stored{" "}
        <strong className="text-text-primary">only on your machine</strong> via the agent. Access tokens are stored{" "}
        <strong className="text-text-primary">encrypted on the server</strong>.
      </div>

      {isLoading && <p className="text-[12px] text-text-faint">Loading…</p>}

      {!isLoading && (
        <>
          {agentCredentials.length > 0 && (
            <div>
              <h4 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-3">AI credentials (local)</h4>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border bg-bg-inset">
                      <th className="text-left px-4 py-2.5 font-medium text-text-muted">Name</th>
                      <th className="text-left px-4 py-2.5 font-medium text-text-muted">Provider</th>
                      <th className="text-left px-4 py-2.5 font-medium text-text-muted">Type</th>
                      <th className="text-left px-4 py-2.5 font-medium text-text-muted">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentCredentials.map((c: any) => (
                      <tr key={c.name} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-mono text-text-primary">{c.name}</td>
                        <td className="px-4 py-2.5 text-text-muted">{c.provider}</td>
                        <td className="px-4 py-2.5 text-text-muted">{c.type}</td>
                        <td className="px-4 py-2.5 text-text-faint">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-text-faint">
                Manage via CLI: <code className="font-mono bg-bg-inset px-1 rounded">ysa-agent credential add</code>
                {" · "}
                <code className="font-mono bg-bg-inset px-1 rounded">ysa-agent credential remove &lt;name&gt;</code>
              </p>
            </div>
          )}

          {agentCredentials.length === 0 && (
            <div>
              <h4 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-3">AI credentials (local)</h4>
              <div className="p-4 rounded-lg border border-border bg-bg-surface text-[12px] text-text-muted space-y-2">
                <p>No AI credentials stored. Add one from your terminal:</p>
                <pre className="px-3 py-2 bg-bg-inset rounded font-mono text-[11px] text-text-primary select-all">ysa-agent credential add --provider claude --type api_key</pre>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide">Access tokens (server)</h4>
              <button
                onClick={() => setAddOpen((o) => !o)}
                className="px-3 py-1.5 rounded-lg border border-border text-[12px] text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
              >
                {addOpen ? "Cancel" : "+ Add"}
              </button>
            </div>

            {addOpen && (
              <div className="mb-4 p-4 rounded-lg border border-border bg-bg-surface space-y-3">
                <div className="flex gap-2">
                  <input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="Name (e.g. my-gitlab-token)"
                    className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors"
                  />
                  <select
                    value={addProvider}
                    onChange={(e) => setAddProvider(e.target.value)}
                    className="px-3 py-2 bg-bg border border-border rounded-lg text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors cursor-pointer"
                  >
                    <option value="gitlab">GitLab</option>
                    <option value="github">GitHub</option>
                  </select>
                </div>
                <input
                  type="password"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  placeholder="Token value"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-[13px] font-mono text-text-primary focus:outline-none focus:border-primary transition-colors"
                />
                <button
                  disabled={!addName.trim() || !addValue.trim() || addMutation.isPending}
                  onClick={() => addMutation.mutate({ name: addName.trim(), provider: addProvider, type: "access_token", value: addValue })}
                  className="px-4 py-2 rounded-lg text-[12px] font-medium bg-primary text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  {addMutation.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            )}

            {serverCredentials.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border bg-bg-inset">
                      <th className="text-left px-4 py-2.5 font-medium text-text-muted">Name</th>
                      <th className="text-left px-4 py-2.5 font-medium text-text-muted">Provider</th>
                      <th className="text-left px-4 py-2.5 font-medium text-text-muted">Added</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {serverCredentials.map((c: any) => (
                      <tr key={c.name} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-mono text-text-primary">{c.name}</td>
                        <td className="px-4 py-2.5 text-text-muted">{c.provider}</td>
                        <td className="px-4 py-2.5 text-text-faint">{c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => removeMutation.mutate({ name: c.name })}
                            disabled={removeMutation.isPending}
                            className="text-[11px] text-err hover:text-err/70 transition-colors cursor-pointer"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {serverCredentials.length === 0 && !addOpen && (
              <p className="text-[12px] text-text-faint">No access tokens yet.</p>
            )}
          </div>

          <button
            onClick={() => { refetchAgent(); refetchServer(); }}
            className="px-3 py-1.5 rounded-lg border border-border text-[12px] text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
          >
            Refresh
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

const NAV = [
  { id: "profile", label: "Profile" },
  { id: "credentials", label: "Credentials" },
];

export function AccountSettingsPanel({ onClose }: Props) {
  const [activeSection, setActiveSection] = useState("profile");

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-raised">
      <div className="shrink-0 flex items-center gap-3 px-6 h-14 border-b border-border">
        <button
          onClick={onClose}
          className="p-1.5 rounded text-text-faint hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 className="text-[14px] font-semibold text-text-primary">My account</h2>
      </div>

      <div className="flex flex-1 min-h-0">
        <nav className="w-44 shrink-0 border-r border-border py-4 px-2 flex flex-col gap-0.5">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`px-2 py-1.5 text-[12px] font-medium rounded-md text-left cursor-pointer transition-colors ${
                activeSection === item.id
                  ? "text-text-primary bg-bg-surface"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-surface"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          <div className="px-8 py-8 max-w-2xl">
            {activeSection === "profile" ? <ProfileSection /> : <CredentialsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
