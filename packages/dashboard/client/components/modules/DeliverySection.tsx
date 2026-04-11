import { useCallback, useState } from "react";
import { trpc } from "../../trpc";

interface DeliverySectionProps {
  issueId: number;
  stepSlug: string;
  status: string;
  issueSource?: string | null;
}

interface DeliveryData {
  mr_url?: string;
  branch?: string;
  commit_hash?: string;
  commit_message?: string;
  files_changed?: string[];
}

export function DeliverySection({ issueId, stepSlug, status, issueSource }: DeliverySectionProps) {
  const [data] = trpc.tasks.stepModuleData.useSuspenseQuery(
    { id: String(issueId), stepSlug, module: "delivery" },
    {
      retry: false,
      refetchInterval: status === "running" ? 3000 : false,
    },
  );

  if (!data) return null;

  let parsed: DeliveryData = {};
  try {
    parsed = typeof data === "string" ? JSON.parse(data) : (data as DeliveryData);
  } catch {
    return null;
  }

  const { mr_url, branch, commit_hash, commit_message, files_changed } = parsed;
  if (!mr_url && !branch && !commit_hash && !files_changed?.length) return null;

  const prLabel = issueSource === "github" ? "Pull Request" : "Merge Request";

  return (
    <section className="animate-[slide-up_0.3s_ease-out]">
      <div className="rounded-lg border border-border-bright overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface-bright border-b border-border-bright">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="text-text-secondary">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">Delivery</span>
        </div>
        <div className="bg-bg-raised px-5 py-4">
          <div className="grid gap-2.5">
            <Row label={prLabel}>
              {mr_url ? (
                <a href={mr_url} target="_blank" rel="noopener" className="text-primary hover:underline break-all">
                  {mr_url}
                </a>
              ) : "N/A"}
            </Row>

            <Row label="Branch">
              <div className="flex items-center gap-1.5">
                <code className="font-mono text-[13px]">{branch || ""}</code>
                {branch && <CopyButton getValue={() => branch} />}
              </div>
            </Row>

            <Row label="Commit">
              <div className="flex items-center gap-1.5 flex-wrap">
                <code className="font-mono text-[13px]">{(commit_hash || "").slice(0, 8)}</code>
                {commit_message && <span className="text-[13px]">{commit_message}</span>}
                {commit_hash && <CopyButton getValue={() => commit_hash} />}
              </div>
            </Row>

            <Row label="Files Changed">
              {files_changed?.length ? (
                <ul className="list-none p-0">
                  {files_changed.map((f, i) => (
                    <li key={i} className="font-mono text-[13px] py-0.5">
                      {typeof f === "string" ? f : (f as any)?.path ?? JSON.stringify(f)}
                    </li>
                  ))}
                </ul>
              ) : "None"}
            </Row>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border-subtle last:border-b-0">
      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-widest min-w-[120px] shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-[13px] break-all">{children}</span>
    </div>
  );
}

function CopyButton({ getValue }: { getValue: () => string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(getValue()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [getValue]);
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className="flex items-center gap-1 text-[10px] text-text-faint hover:text-text-secondary transition-colors cursor-pointer px-1 shrink-0"
    >
      {copied ? (
        <>
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Copied</span>
        </>
      ) : (
        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}
