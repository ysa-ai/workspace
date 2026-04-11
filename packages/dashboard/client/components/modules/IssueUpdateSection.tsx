import { useMemo, useEffect, useRef } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import { trpc } from "../../trpc";

interface IssueUpdateSectionProps {
  issueId: number;
  stepSlug: string;
  status: string;
  issueSource?: string | null;
}

interface IssueUpdateData {
  comment_url?: string;
  note_content?: string;
  labels_added?: string[];
  labels_removed?: string[];
}

export function IssueUpdateSection({ issueId, stepSlug, status, issueSource }: IssueUpdateSectionProps) {
  const utils = trpc.useUtils();

  const [data] = trpc.tasks.stepModuleData.useSuspenseQuery(
    { id: String(issueId), stepSlug, module: "issue_update" },
    {
      retry: false,
      refetchInterval: status === "running" ? 3000 : false,
    },
  );

  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (status !== prevStatusRef.current) {
      prevStatusRef.current = status;
      utils.tasks.stepModuleData.invalidate({ id: String(issueId), stepSlug, module: "issue_update" });
    }
  }, [status, issueId, stepSlug, utils]);

  const html = useMemo(() => {
    let parsed: IssueUpdateData = {};
    try {
      parsed = typeof data === "string" ? JSON.parse(data) : (data as IssueUpdateData ?? {});
    } catch {
      return "";
    }
    if (!parsed.note_content) return "";
    const raw = marked.parse(parsed.note_content) as string;
    const div = document.createElement("div");
    div.innerHTML = raw;
    div.querySelectorAll("pre code").forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });
    return div.innerHTML;
  }, [data]);

  if (!data) return null;

  let parsed: IssueUpdateData = {};
  try {
    parsed = typeof data === "string" ? JSON.parse(data) : (data as IssueUpdateData);
  } catch {
    return null;
  }

  const { comment_url, labels_added = [], labels_removed = [] } = parsed;
  if (!html && !comment_url && !labels_added.length && !labels_removed.length) return null;

  const source = issueSource === "github" ? "GitHub" : "GitLab";

  return (
    <section className="animate-[slide-up_0.3s_ease-out]">
      <div className="rounded-lg border border-border-bright overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface-bright border-b border-border-bright">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="text-text-secondary">
            <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4l-4 4-4-4z" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">Issue Update</span>
          {comment_url && (
            <a href={comment_url} target="_blank" rel="noopener" className="ml-auto text-[11px] text-primary hover:underline">
              View on {source} →
            </a>
          )}
        </div>
        <div className="bg-bg-raised px-5 py-4 space-y-4">
          {html && (
            <div className="result-markdown" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          {(labels_added.length > 0 || labels_removed.length > 0) && (
            <div className={html ? "pt-3 border-t border-border-subtle" : ""}>
              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-2">Label Changes</p>
              <div className="flex flex-wrap gap-1.5">
                {labels_added.map((label) => (
                  <span key={`add-${label}`} className="px-2 py-0.5 rounded text-[12px] font-medium bg-ok-bg text-ok">
                    + {label}
                  </span>
                ))}
                {labels_removed.map((label) => (
                  <span key={`rm-${label}`} className="px-2 py-0.5 rounded text-[12px] font-medium bg-err-bg text-err line-through">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
