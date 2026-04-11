import { useState } from "react";
import { trpc } from "../trpc";
import { useToast } from "./Toast";
import { track } from "../lib/analytics";

export function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    owner: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    admin: "bg-primary-subtle text-primary border-primary/20",
    member: "bg-bg-surface text-text-muted border-border",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${colors[role] ?? colors.member}`}>
      {role}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function OrgMembersSection({ currentUserId, currentUserRole }: {
  currentUserId: number;
  currentUserRole: string;
}) {
  const showToast = useToast();
  const utils = trpc.useUtils();
  const isAdminOrOwner = currentUserRole === "owner" || currentUserRole === "admin";
  const isOwner = currentUserRole === "owner";

  const { data: members = [], isLoading: membersLoading } = trpc.auth.listMembers.useQuery();
  const { data: invites = [] } = trpc.auth.listInvites.useQuery(undefined, { enabled: isAdminOrOwner });

  const [inviteRole] = useState<"member">("member");
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteMutation = trpc.auth.inviteMember.useMutation({
    onSuccess: (data) => {
      track("invite_sent");
      setGeneratedUrl(`${window.location.origin}/app/invite/${data.token}`);
      utils.auth.listInvites.invalidate();
    },
    onError: (err) => showToast(err.message, "error"),
  });
  const revokeMutation = trpc.auth.revokeInvite.useMutation({
    onSuccess: () => { utils.auth.listInvites.invalidate(); showToast("Invite revoked", "success"); },
    onError: (err) => showToast(err.message, "error"),
  });
  const removeMutation = trpc.auth.removeMember.useMutation({
    onSuccess: () => { utils.auth.listMembers.invalidate(); showToast("Member removed", "success"); },
    onError: (err) => showToast(err.message, "error"),
  });
  const updateRoleMutation = trpc.auth.updateMemberRole.useMutation({
    onSuccess: () => { utils.auth.listMembers.invalidate(); showToast("Role updated", "success"); },
    onError: (err) => showToast(err.message, "error"),
  });
  const forceResetMutation = trpc.auth.forcePasswordReset.useMutation({
    onSuccess: () => showToast("Password reset — user must set a new password on next sign in", "success"),
    onError: (err) => showToast(err.message, "error"),
  });

  function copyToClipboard(url: string) {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div>
      <section className="mb-10">
        <h3 className="text-[13px] font-semibold text-text-primary mb-4">Members</h3>
        {membersLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="h-10 bg-bg-surface animate-pulse rounded-lg" />)}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 bg-bg">
                <span className="flex-1 text-[13px] text-text-primary truncate">{m.email}</span>
                <RoleBadge role={m.role} />
                {isAdminOrOwner && m.userId !== currentUserId && m.role !== "owner" && (
                  <div className="flex items-center gap-2">
                    {isOwner && (
                      <select
                        value={m.role}
                        onChange={(e) => updateRoleMutation.mutate({ userId: m.userId, role: e.target.value as "admin" | "member" })}
                        className="text-[12px] bg-bg-surface border border-border rounded px-2 py-1 text-text-primary cursor-pointer focus:outline-none"
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                      </select>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => forceResetMutation.mutate({ userId: m.userId })}
                        disabled={forceResetMutation.isPending}
                        className="text-[12px] text-text-faint hover:text-warn transition-colors cursor-pointer px-2 py-1 rounded hover:bg-warn/10"
                        title="Force password reset on next sign in"
                      >
                        Reset pwd
                      </button>
                    )}
                    <button
                      onClick={() => removeMutation.mutate({ userId: m.userId })}
                      disabled={removeMutation.isPending}
                      className="text-[12px] text-text-faint hover:text-err transition-colors cursor-pointer px-2 py-1 rounded hover:bg-err/10"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {isAdminOrOwner && (
        <>
          <section className="mb-10">
            <h3 className="text-[13px] font-semibold text-text-primary mb-4">Invite member</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setGeneratedUrl(null); inviteMutation.mutate({ role: inviteRole }); }}
                disabled={inviteMutation.isPending}
                className="px-4 py-2 bg-primary-subtle border border-primary/30 rounded-lg text-[12px] font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {inviteMutation.isPending ? "Generating…" : "Generate invite link"}
              </button>
            </div>
            {generatedUrl && (
              <div className="mt-3 flex items-center gap-2 p-3 bg-bg-surface border border-border rounded-lg">
                <span className="flex-1 text-[12px] text-text-muted font-mono truncate">{generatedUrl}</span>
                <button
                  onClick={() => copyToClipboard(generatedUrl)}
                  className="shrink-0 px-3 py-1 rounded text-[12px] font-medium border border-border text-text-primary hover:bg-bg transition-colors cursor-pointer"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}
            <p className="mt-2 text-[11px] text-text-faint">Links expire after 7 days. Anyone with the link who has an account gets added to the org.</p>
          </section>

          {invites.length > 0 && (
            <section className="mb-10">
              <h3 className="text-[13px] font-semibold text-text-primary mb-4">Pending invites</h3>
              <div className="border border-border rounded-lg overflow-hidden">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 bg-bg">
                    <RoleBadge role={inv.role} />
                    <span className="flex-1 text-[12px] text-text-muted">
                      Created {formatDate(inv.created_at)} · Expires {formatDate(inv.expires_at)}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyToClipboard(`${window.location.origin}/app/invite/${inv.token}`)}
                        className="text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer px-2 py-1 rounded hover:bg-bg-surface"
                      >
                        Copy link
                      </button>
                      <button
                        onClick={() => revokeMutation.mutate({ inviteId: inv.id })}
                        disabled={revokeMutation.isPending}
                        className="text-[12px] text-text-faint hover:text-err transition-colors cursor-pointer px-2 py-1 rounded hover:bg-err/10"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
