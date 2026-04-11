import { trpc } from "../../trpc";

interface ChangeReportProps {
  issueId: number;
  status: string;
}

interface FileDiff {
  header: string;
  lines: { text: string; type: "add" | "remove" | "hunk" | "context" }[];
}

function parseDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const m = line.match(/diff --git a\/(.+) b\/(.+)/);
      current = { header: m?.[2] ?? line, lines: [] };
    } else if (!current) {
      continue;
    } else if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("Binary")) {
      continue;
    } else if (line.startsWith("@@")) {
      current.lines.push({ text: line, type: "hunk" });
    } else if (line.startsWith("+")) {
      current.lines.push({ text: line.slice(1), type: "add" });
    } else if (line.startsWith("-")) {
      current.lines.push({ text: line.slice(1), type: "remove" });
    } else {
      current.lines.push({ text: line.slice(1), type: "context" });
    }
  }
  if (current) files.push(current);
  return files.filter((f) => f.lines.length > 0);
}

export function ChangeReport({ issueId, status }: ChangeReportProps) {
  const isRunning = ["running", "starting"].includes(status);
  const { data } = trpc.tasks.changeReport.useQuery(
    { id: String(issueId) },
    { retry: false, refetchInterval: (query) => (isRunning || !query.state.data) ? 3000 : false },
  );

  if (!data?.diff) return null;

  const files = parseDiff(data.diff);
  if (files.length === 0) return null;

  const addCount = files.flatMap((f) => f.lines).filter((l) => l.type === "add").length;
  const removeCount = files.flatMap((f) => f.lines).filter((l) => l.type === "remove").length;

  return (
    <section data-onboarding="change-report">
      <div className="rounded-lg border border-border-bright overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface-bright border-b border-border-bright">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="text-text-secondary">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[11px] font-semibold text-text-primary uppercase tracking-widest">Change Report</span>
          <span className="ml-auto flex items-center gap-2 text-[11px] font-mono">
            <span className="text-ok">+{addCount}</span>
            <span className="text-err">-{removeCount}</span>
            <span className="text-text-faint">{files.length} file{files.length !== 1 ? "s" : ""}</span>
          </span>
        </div>
        <div className="bg-bg-raised divide-y divide-border-bright max-h-[500px] overflow-auto">
          {files.map((file) => (
            <div key={file.header}>
              <div className="px-4 py-1.5 bg-bg-surface text-[11px] font-mono text-text-secondary font-medium truncate">
                {file.header}
              </div>
              <div className="font-mono text-[11px] leading-5">
                {file.lines.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.type === "add"
                        ? "bg-ok/10 text-ok px-4 whitespace-pre-wrap"
                        : line.type === "remove"
                          ? "bg-err/10 text-err px-4 whitespace-pre-wrap"
                          : line.type === "hunk"
                            ? "text-text-faint px-4 bg-bg-inset whitespace-pre"
                            : "text-text-muted px-4 whitespace-pre-wrap"
                    }
                  >
                    <span className="select-none mr-2 opacity-50">{line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}</span>
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
