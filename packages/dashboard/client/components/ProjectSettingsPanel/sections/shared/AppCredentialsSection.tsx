import { useState, useEffect } from "react";
import { trpc } from "../../../../trpc";
import { useToast } from "../../../Toast";
import { Field } from "../../ui";
import { INPUT_CLS } from "../../types";

interface CredEntry {
  id: string;
  name: string;
  loginUrl: string;
  username: string;
  password: string;
  hasPassword: boolean;
}

function newEntry(): CredEntry {
  return { id: crypto.randomUUID(), name: "", loginUrl: "", username: "", password: "", hasPassword: false };
}

export function AppCredentialsSection({ projectId, isAdminOrOwner }: { projectId: string; isAdminOrOwner: boolean }) {
  const showToast = useToast();
  const utils = trpc.useUtils();
  const [creds, setCreds] = useState<CredEntry[]>([]);

  const { data } = trpc.projects.getAppCredentials.useQuery({ projectId }, { refetchOnWindowFocus: false });

  useEffect(() => {
    if (data?.credentials) {
      setCreds(data.credentials.map((c) => ({
        id: crypto.randomUUID(),
        name: c.name,
        loginUrl: c.loginUrl,
        username: c.username,
        password: "",
        hasPassword: c.hasPassword,
      })));
    }
  }, [data]);

  const saveMutation = trpc.projects.updateAppCredentials.useMutation({
    onSuccess: () => {
      showToast("Credentials saved", "success");
      utils.projects.getAppCredentials.invalidate({ projectId });
    },
    onError: (err) => showToast(err.message, "error"),
  });

  function update(id: string, patch: Partial<CredEntry>) {
    setCreds((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function save() {
    const invalid = creds.find((c) => !c.name.trim());
    if (invalid) { showToast("Every credential needs a name", "error"); return; }
    saveMutation.mutate({
      projectId,
      credentials: creds.map((c) => ({
        name: c.name.trim(),
        loginUrl: c.loginUrl.trim() || undefined,
        username: c.username.trim() || undefined,
        password: c.password || undefined,
      })),
    });
  }

  if (!isAdminOrOwner) {
    return (
      <div className="p-4 rounded-lg border border-border bg-bg-surface text-[12px] text-text-muted">
        Only project admins can manage app credentials.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-bg-inset border border-border text-[12px] text-text-muted">
        Logins the agent uses to sign in to the app while testing (e.g. frontend checks). Each is injected into the
        container as <code className="font-mono bg-bg-surface px-1 rounded">APP_CRED_&lt;NAME&gt;_USERNAME</code> /{" "}
        <code className="font-mono bg-bg-surface px-1 rounded">_PASSWORD</code> /{" "}
        <code className="font-mono bg-bg-surface px-1 rounded">_URL</code>. Passwords are stored encrypted and never
        shown again.
      </div>

      {creds.length === 0 && (
        <div className="p-4 rounded-lg border border-border bg-bg-surface text-[12px] text-text-muted">
          No app credentials yet. Add one below.
        </div>
      )}

      <div className="space-y-2">
        {creds.map((c) => (
          <div key={c.id} className="p-3 rounded-lg border border-border bg-bg-surface space-y-2">
            <div className="flex items-end justify-between gap-2">
              <div className="flex-1 min-w-0">
                <Field label="Name">
                  <input
                    value={c.name}
                    onChange={(e) => update(c.id, { name: e.target.value })}
                    className={INPUT_CLS}
                    placeholder="e.g. admin, user"
                  />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => setCreds((cs) => cs.filter((x) => x.id !== c.id))}
                className="mb-2 shrink-0 text-text-faint hover:text-err cursor-pointer transition-colors"
                title="Remove"
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Username / email">
                <input
                  value={c.username}
                  onChange={(e) => update(c.id, { username: e.target.value })}
                  className={INPUT_CLS}
                  placeholder="user@example.com"
                />
              </Field>
              <Field label="Password" hint={c.hasPassword ? "Saved. Leave blank to keep it, or type to replace." : undefined}>
                <input
                  type="password"
                  value={c.password}
                  onChange={(e) => update(c.id, { password: e.target.value })}
                  className={INPUT_CLS}
                  placeholder={c.hasPassword ? "Leave blank to keep saved password" : ""}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <Field label="Login URL (optional)" hint="Where the agent should sign in">
              <input
                value={c.loginUrl}
                onChange={(e) => update(c.id, { loginUrl: e.target.value })}
                className={INPUT_CLS}
                placeholder="https://app.example.com/login"
              />
            </Field>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCreds((cs) => [...cs, newEntry()])}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-text-muted hover:text-text-primary border border-border rounded-lg bg-bg-inset cursor-pointer transition-colors"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add credential
        </button>
        {creds.length > 0 && (
          <button
            type="button"
            onClick={save}
            disabled={saveMutation.isPending}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-primary text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {saveMutation.isPending ? "Saving..." : "Save credentials"}
          </button>
        )}
      </div>
    </div>
  );
}
