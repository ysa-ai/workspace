import { trpc } from "../../trpc";
import { useToast } from "../Toast";

interface ManualQASectionProps {
  issueId: number;
  stepSlug: string;
  status: string;
}

interface QACriterion {
  id: string;
  description: string;
  status: "pending" | "passed" | "failed";
}

interface ManualQAData {
  qa_items?: QACriterion[];
}

export function ManualQASection({ issueId, stepSlug, status }: ManualQASectionProps) {
  const showToast = useToast();
  const utils = trpc.useUtils();

  const [data] = trpc.tasks.stepModuleData.useSuspenseQuery(
    { id: String(issueId), stepSlug, module: "manual_qa" },
    {
      retry: false,
      refetchInterval: status === "running" ? 3000 : false,
    },
  );

  const updateMutation = trpc.tasks.updateStepModuleData.useMutation({
    onSuccess: () => utils.tasks.stepModuleData.invalidate({ id: String(issueId), stepSlug, module: "manual_qa" }),
    onError: (err) => showToast(err.message, "error"),
  });

  if (!data) return null;

  let parsed: ManualQAData = {};
  try {
    parsed = typeof data === "string" ? JSON.parse(data) : (data as ManualQAData);
  } catch {
    return null;
  }

  const criteria = parsed.qa_items ?? [];
  if (!criteria.length) return null;

  const passed = criteria.filter((c) => c.status === "passed").length;
  const failed = criteria.filter((c) => c.status === "failed").length;
  const pending = criteria.filter((c) => c.status === "pending").length;

  function toggle(id: string, current: QACriterion["status"]) {
    const next: QACriterion["status"] =
      current === "pending" ? "passed" : current === "passed" ? "failed" : "pending";
    const updatedCriteria = criteria.map((c) =>
      c.id === id ? { ...c, status: next } : c,
    );
    updateMutation.mutate({
      id: String(issueId),
      stepSlug,
      module: "manual_qa",
      data: JSON.stringify({ qa_items: updatedCriteria }),
    });
  }

  return (
    <section>
      <div className="rounded-lg border border-border-bright overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface-bright border-b border-border-bright">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="text-text-secondary">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">Manual QA</span>
          <span className="text-[10px] font-mono text-text-faint bg-bg-inset px-1.5 py-0.5 rounded">{criteria.length}</span>
          <div className="flex items-center gap-2.5 ml-auto text-[10px] font-medium">
            <span className="text-ok">{passed} passed</span>
            {failed > 0 && <span className="text-err">{failed} failed</span>}
            <span className="text-text-muted">{pending} pending</span>
          </div>
        </div>
        <div className="bg-bg-raised">
          {criteria.map((c, i) => {
            const icon = c.status === "passed" ? "✓" : c.status === "failed" ? "✗" : "○";
            const iconCls =
              c.status === "passed" ? "text-ok" : c.status === "failed" ? "text-err" : "text-text-faint";
            return (
              <div
                key={c.id}
                className={`flex items-start gap-3 py-2.5 px-4 ${i < criteria.length - 1 ? "border-b border-border-subtle" : ""}`}
              >
                <button
                  className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-sm font-bold cursor-pointer hover:bg-bg-surface ${iconCls}`}
                  onClick={() => toggle(c.id, c.status)}
                  title={`Click to mark as ${c.status === "pending" ? "passed" : c.status === "passed" ? "failed" : "pending"}`}
                  disabled={updateMutation.isPending}
                >
                  {icon}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-mono text-text-faint">{c.id}</span>
                  </div>
                  <Description text={c.description} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Description({ text }: { text: string }) {
  const lines = (text || "").split("\n");
  const hasBullets = lines.some((l) => l.startsWith("- "));
  if (!hasBullets) {
    return <p className="text-[13px] text-text-primary leading-relaxed whitespace-pre-line">{text}</p>;
  }
  return (
    <ul className="text-[13px] text-text-primary leading-relaxed list-none p-0 m-0">
      {lines.map((line, i) => {
        const isBullet = line.startsWith("- ");
        return (
          <li key={i} className={isBullet ? "flex items-baseline gap-1.5 py-0.5" : "py-0.5"}>
            {isBullet && <span className="text-text-faint shrink-0">&#x2022;</span>}
            {isBullet ? line.slice(2) : line}
          </li>
        );
      })}
    </ul>
  );
}
