import { trpc } from "../../trpc";

interface UnitTestsSectionProps {
  issueId: number;
  stepSlug: string;
  status: string;
}

interface UnitTestsData {
  tests?: "passed" | "failed" | "skipped";
  test_details?: string;
}

export function UnitTestsSection({ issueId, stepSlug, status }: UnitTestsSectionProps) {
  const [data] = trpc.tasks.stepModuleData.useSuspenseQuery(
    { id: String(issueId), stepSlug, module: "unit_tests" },
    {
      retry: false,
      refetchInterval: status === "running" ? 3000 : false,
    },
  );

  if (!data) return null;

  let parsed: UnitTestsData = {};
  try {
    parsed = typeof data === "string" ? JSON.parse(data) : (data as UnitTestsData);
  } catch {
    return null;
  }

  const { tests, test_details } = parsed;
  if (!tests) return null;

  const badgeCls =
    tests === "passed"
      ? "bg-ok-bg text-ok"
      : tests === "failed"
        ? "bg-err-bg text-err"
        : "bg-bg-surface text-text-muted";

  return (
    <section className="animate-[slide-up_0.3s_ease-out]">
      <div className="rounded-lg border border-border-bright overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface-bright border-b border-border-bright">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className={tests === "passed" ? "text-ok" : tests === "failed" ? "text-err" : "text-text-secondary"}>
            <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0H5a2 2 0 0 1-2-2v-4m6 6h10a2 2 0 0 0 2-2V9m-6 11v-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">Unit Tests</span>
          <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${badgeCls}`}>
            {tests}
          </span>
        </div>
        {test_details && (
          <div className="bg-bg-raised">
            <pre className="px-4 py-3 text-[11px] font-mono text-text-muted whitespace-pre-wrap break-all overflow-auto max-h-64">
              {test_details}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
