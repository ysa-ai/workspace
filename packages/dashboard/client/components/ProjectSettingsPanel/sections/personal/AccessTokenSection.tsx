import { useFormContext, Controller } from "react-hook-form";
import { Field } from "../../ui";
import { INPUT_CLS } from "../../types";
import type { UserFormValues } from "../../types";
import { trpc } from "../../../../trpc";

export function AccessTokenSection({ issueSourceLabel }: { issueSourceLabel: string }) {
  const { control } = useFormContext<UserFormValues>();
  const { data, isLoading } = trpc.projects.listServerCredentials.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const credentials = (data?.credentials ?? []).filter((c: any) => c.type === "access_token");

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-bg-inset border border-border text-[12px] text-text-muted">
        Your personal <strong className="text-text-primary">{issueSourceLabel} token</strong>. Only visible to you —
        overrides the shared org token if set. Manage tokens in{" "}
        <strong className="text-text-primary">My account → Credentials</strong>.
      </div>

      {!isLoading && credentials.length === 0 && (
        <div className="p-4 rounded-lg border border-border bg-bg-surface text-[12px] text-text-muted space-y-1">
          <p className="font-medium text-text-primary">No access tokens found</p>
          <p>Add one in <strong>My account → Credentials</strong>.</p>
        </div>
      )}

      {credentials.length > 0 && (
        <Field label={`Personal ${issueSourceLabel} token`} hint="Overrides the shared org token. Leave empty to use the org token.">
          <Controller
            control={control}
            name="issue_source_credential_name"
            render={({ field }) => (
              <select
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value || null)}
                className={`${INPUT_CLS} cursor-pointer`}
              >
                <option value="">— None (use org token) —</option>
                {credentials.map((c: any) => (
                  <option key={c.name} value={c.name}>{c.name} ({c.provider})</option>
                ))}
              </select>
            )}
          />
        </Field>
      )}
    </div>
  );
}
