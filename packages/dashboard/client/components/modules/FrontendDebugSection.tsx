import { trpc } from "../../trpc";

interface FrontendDebugSectionProps {
  issueId: number;
  stepSlug: string;
  status: string;
}

interface FrontendDebugData {
  status?: "passed" | "failed";
  summary?: string;
  screenshots?: string[];
  console_errors?: string;
}

export function FrontendDebugSection({ issueId, stepSlug, status }: FrontendDebugSectionProps) {
  const [data] = trpc.tasks.stepModuleData.useSuspenseQuery(
    { id: String(issueId), stepSlug, module: "frontend_debug" },
    {
      retry: false,
      refetchInterval: status === "running" ? 3000 : false,
    },
  );

  if (!data) return null;

  let parsed: FrontendDebugData = {};
  try {
    parsed = typeof data === "string" ? JSON.parse(data) : (data as FrontendDebugData);
  } catch {
    return null;
  }

  const { status: result, summary, screenshots, console_errors } = parsed;
  if (!result) return null;

  const badgeCls = result === "passed"
    ? "bg-ok-bg text-ok"
    : "bg-err-bg text-err";

  return (
    <section className="animate-[slide-up_0.3s_ease-out]">
      <div className="rounded-lg border border-border-bright overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface-bright border-b border-border-bright">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className={result === "passed" ? "text-ok" : "text-err"}>
            <rect x="2" y="3" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 21h8M12 17v4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">Frontend Debug</span>
          <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${badgeCls}`}>
            {result}
          </span>
        </div>

        {summary && (
          <div className="px-4 py-3 border-b border-border-bright">
            <p className="text-[12px] text-text-secondary whitespace-pre-wrap">{summary}</p>
          </div>
        )}

        {console_errors && (
          <div className="bg-bg-raised border-b border-border-bright">
            <div className="px-4 pt-2 pb-1">
              <span className="text-[10px] font-semibold text-err uppercase tracking-widest">Console Errors</span>
            </div>
            <pre className="px-4 pb-3 text-[11px] font-mono text-err whitespace-pre-wrap break-all overflow-auto max-h-40">
              {console_errors}
            </pre>
          </div>
        )}

        {screenshots && screenshots.length > 0 && (
          <div className="p-4 flex flex-col gap-3 bg-bg-raised">
            {screenshots.map((b64, i) => (
              <img
                key={i}
                src={`data:image/png;base64,${b64}`}
                alt={`Screenshot ${i + 1}`}
                className="rounded border border-border-bright max-w-full"
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
