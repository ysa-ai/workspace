import { useState, useEffect, useRef } from "react";
import { trpc } from "../trpc";
import { useToast } from "./Toast";
import { track } from "../lib/analytics";

const PROVIDERS = [
  { id: "claude", name: "Claude Code" },
  { id: "mistral", name: "Mistral" },
] as const;

const MODELS_BY_PROVIDER: Record<string, { id: string; name: string }[]> = {
  claude: [
    { id: "claude-sonnet-4-6", name: "Sonnet 4.6" },
    { id: "claude-sonnet-4-5", name: "Sonnet 4.5" },
    { id: "claude-opus-4-6", name: "Opus 4.6" },
  ],
  mistral: [
    { id: "devstral-2", name: "Devstral 2" },
    { id: "mistral-large-latest", name: "Mistral Large 3" },
    { id: "mistral-medium-latest", name: "Mistral Medium 3.1" },
    { id: "devstral-small-latest", name: "Devstral Small" },
    { id: "codestral-latest", name: "Codestral" },
  ],
};

interface ProjectDefaults {
  llm_provider: string;
  llm_model: string | null;
  llm_max_turns: number;
  network_policy: string;
  issue_source?: string | null;
  issue_url_template?: string | null;
}

interface IssueInputProps {
  projectId: string | null;
  projectDefaults?: ProjectDefaults | null;
  onInitialized?: (firstId: number) => void;
  prefillPrompt?: string;
}

const SOURCE_LABEL: Record<string, string> = { github: "GitHub", gitlab: "GitLab" };

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-primary bg-bg-surface border border-border rounded px-2 py-0.5">
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-3.5 h-3.5 text-text-faint" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

interface PendingConflict {
  id: number;
  branch: string;
}

interface PendingInit {
  params: Parameters<ReturnType<typeof trpc.actions.init.useMutation>["mutate"]>[0];
  conflicts: PendingConflict[];
}

export function IssueInput({ projectId, projectDefaults, onInitialized, prefillPrompt }: IssueInputProps) {
  const [mode, setMode] = useState<"search" | "prompt">(prefillPrompt || !projectDefaults?.issue_url_template ? "prompt" : "search");
  const [promptText, setPromptText] = useState(prefillPrompt ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIssues, setSelectedIssues] = useState<Map<number, string>>(new Map()); // id → title
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pendingInit, setPendingInit] = useState<PendingInit | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const showToast = useToast();
  const utils = trpc.useUtils();

  const issueSource = projectDefaults?.issue_source;
  const canBrowse = !!projectDefaults?.issue_url_template;

  const [provider, setProvider] = useState(projectDefaults?.llm_provider || "claude");
  const [model, setModel] = useState(projectDefaults?.llm_model || "claude-sonnet-4-6");
  const [maxTurns, setMaxTurns] = useState(projectDefaults?.llm_max_turns || 60);
  const [networkPolicy, setNetworkPolicy] = useState<"none" | "strict">(
    (projectDefaults?.network_policy as "none" | "strict") || "none",
  );

  useEffect(() => {
    setProvider(projectDefaults?.llm_provider || "claude");
    setModel(projectDefaults?.llm_model || "claude-sonnet-4-6");
    setMaxTurns(projectDefaults?.llm_max_turns || 60);
    setNetworkPolicy((projectDefaults?.network_policy as "none" | "strict") || "none");
  }, [projectDefaults?.llm_provider, projectDefaults?.llm_model, projectDefaults?.llm_max_turns, projectDefaults?.network_policy]);

  // Reset selection when project changes
  useEffect(() => {
    setSelectedIssues(new Map());
    setSearchQuery("");
    setDebouncedQuery("");
    setPromptText(prefillPrompt ?? "");
    setMode(prefillPrompt || !projectDefaults?.issue_url_template ? "prompt" : "search");
  }, [projectId]);

  // 300ms debounce on search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: browseData, isFetching: isBrowsing } = trpc.tasks.browse.useQuery(
    { projectId: projectId!, query: debouncedQuery || undefined },
    {
      enabled: !!projectId && (mode === "search"),
      retry: false,
    },
  );


  const initMutation = trpc.actions.init.useMutation({
    onSuccess: async (data, variables) => {
      if (data.initialized?.length) track("issue_run_started", { count: data.initialized.length, source_type: variables.source_type });
      if ((data as any).conflicts?.length) {
        setPendingInit({ params: variables, conflicts: (data as any).conflicts });
        return;
      }
      const parts: string[] = [];
      if (data.initialized?.length) parts.push(`Initialized: #${data.initialized.join(", #")}`);
      if (data.skipped?.length) parts.push(`Skipped: ${data.skipped.map((s: { id: number; reason: string }) => `#${s.id} (${s.reason})`).join(", ")}`);
      showToast(parts.join(" — ") || "Done", "success");
      await utils.tasks.invalidate();
      if (data.initialized?.[0] != null) onInitialized?.(data.initialized[0]);
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const resolveConflicts = (action: "reuse" | "new") => {
    if (!pendingInit) return;
    const branchResolution = pendingInit.conflicts.map((c) => ({ id: c.id, action }));
    setPendingInit(null);
    initMutation.mutate({ ...pendingInit.params, branchResolution });
  };

  const handleSubmit = () => {
    if (mode === "prompt") {
      if (!promptText.trim()) {
        showToast("Enter a prompt", "error");
        return;
      }
      setPromptText("");
      initMutation.mutate({
        source_type: "prompt",
        prompt: promptText.trim(),
        projectId: projectId ?? undefined,
        networkPolicy,
        llmProvider: provider,
        llmModel: model,
        llmMaxTurns: maxTurns,
      });
      return;
    }

    const ids = [...selectedIssues.keys()];

    if (ids.length === 0) {
      showToast("Select at least one task", "error");
      return;
    }

    setSelectedIssues(new Map());
    setSearchQuery("");

    initMutation.mutate({
      issues: ids,
      projectId: projectId ?? undefined,
      networkPolicy,
      llmProvider: provider,
      llmModel: model,
      llmMaxTurns: maxTurns,
    });
  };

  const toggleIssue = (id: number, title: string) => {
    setSelectedIssues((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id); else next.set(id, title);
      return next;
    });
  };

  const canSubmit = mode === "search" ? selectedIssues.size > 0 : promptText.trim().length > 0;

  const availableModels = MODELS_BY_PROVIDER[provider] ?? [];
  const issues = browseData?.tasks ?? [];

  return (
    <div data-onboarding="issue-input-prompt" className="px-6 py-3.5 border-b border-border bg-bg-raised">
      {/* Header row: source badge + mode toggle */}
      <div className="flex items-center justify-between mb-2">
        {issueSource ? <SourceBadge source={issueSource} /> : <span className="text-[12px] text-text-faint">No source</span>}
        {!prefillPrompt && (
          <div className="flex items-center bg-bg-inset border border-border rounded-md p-0.5 text-[11px] font-medium">
            {(["search", "prompt"] as const).map((m) => {
              const disabled = m === "search" && !canBrowse;
              return (
                <button
                  key={m}
                  disabled={disabled}
                  className={`px-2.5 py-1 rounded transition-all ${
                    disabled
                      ? "text-text-faint opacity-40 cursor-not-allowed"
                      : mode === m
                        ? "bg-bg-surface text-text-primary shadow-sm cursor-pointer"
                        : "text-text-faint hover:text-text-muted cursor-pointer"
                  }`}
                  onClick={() => {
                    if (disabled) return;
                    setMode(m);
                    setSelectedIssues(new Map());
                  }}
                >
                  {m === "search" ? "Browse" : "Prompt"}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {mode === "search" ? (
        <div className="rounded-lg border border-border bg-bg-inset overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-text-faint shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-faint outline-none"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            {isBrowsing && <Spinner />}
          </div>

          {/* Results list */}
          <div ref={listRef} className="max-h-52 overflow-y-auto">
            {issues.length === 0 && !isBrowsing ? (
              <div className="px-3 py-6 text-center text-[12px] text-text-faint">
                {browseData?.fallback
                  ? "No API token configured — add one in project settings"
                  : searchQuery
                    ? "No tasks found"
                    : "No open tasks"}
              </div>
            ) : (
              issues.map((issue) => {
                const selected = selectedIssues.has(issue.id);
                const blockedBy: number[] = (issue as any).blockedBy ?? [];
                const blocked = blockedBy.length > 0;
                return (
                  <button
                    key={issue.id}
                    disabled={blocked}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-[12px] border-b border-border-subtle last:border-b-0 transition-colors ${
                      blocked
                        ? "cursor-not-allowed text-text-muted"
                        : selected
                          ? "bg-primary-subtle text-primary cursor-pointer"
                          : "hover:bg-bg-surface text-text-primary cursor-pointer"
                    }`}
                    onClick={(e) => {
                      if (blocked) return;
                      if ((e.target as HTMLElement).closest("a")) return;
                      toggleIssue(issue.id, issue.title);
                    }}
                  >
                    <span className={`contents ${blocked ? "opacity-40" : ""}`}>
                      {(issue as any).url ? (
                        <a
                          href={(issue as any).url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[11px] shrink-0 text-primary hover:underline"
                        >
                          #{issue.id}
                        </a>
                      ) : (
                        <span className="font-mono text-[11px] text-text-faint shrink-0">#{issue.id}</span>
                      )}
                      <span className="flex-1 truncate">{issue.title}</span>
                    </span>
                    {blocked ? (
                      <span className="text-[10px] text-text-muted font-mono shrink-0">
                        blocked by #{blockedBy.join(", #")}
                      </span>
                    ) : selected ? (
                      <CheckIcon />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {/* Selection summary */}
          {selectedIssues.size > 0 && (
            <div className="px-3 py-1.5 bg-primary-subtle/50 border-t border-border text-[11px] text-primary flex items-center justify-between">
              <span>{selectedIssues.size} selected</span>
              <button className="hover:underline cursor-pointer" onClick={() => setSelectedIssues(new Map())}>
                Clear
              </button>
            </div>
          )}
        </div>
      ) : (
        <textarea
          className={`w-full bg-bg-inset border border-border rounded-lg px-3.5 py-2.5 text-[13px] text-text-primary placeholder:text-text-faint resize-none focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all ${prefillPrompt ? "opacity-80 cursor-default" : ""}`}
          rows={4}
          placeholder="Describe the task in plain text..."
          value={promptText}
          readOnly={!!prefillPrompt}
          onChange={(e) => { if (!prefillPrompt) setPromptText(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
      )}

      <div className="flex items-center justify-between mt-2.5">
        <button
          className={`text-[11px] text-text-faint flex items-center gap-1 transition-colors ${prefillPrompt ? "opacity-40 cursor-not-allowed" : "hover:text-text-muted cursor-pointer"}`}
          onClick={() => { if (!prefillPrompt) setShowAdvanced(!showAdvanced); }}
        >
          <svg
            width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          Advanced
        </button>
        <button
          className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-white transition-all ${
            !canSubmit || initMutation.isPending ? "opacity-40 cursor-not-allowed" : "hover:brightness-110 cursor-pointer"
          }`}
          onClick={handleSubmit}
          disabled={!canSubmit || initMutation.isPending}
        >
          {initMutation.isPending ? "Processing..." : "Process"}
        </button>
      </div>

      {showAdvanced && (
        <div className="mt-3 pt-3 border-t border-border-subtle space-y-2.5 animate-[fade-in_0.15s_ease-out]">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-text-faint w-16 shrink-0">Provider</span>
            <select
              className="flex-1 bg-bg-inset border border-border rounded-md px-2.5 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-primary/40"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel(MODELS_BY_PROVIDER[e.target.value]?.[0]?.id || "");
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-text-faint w-16 shrink-0">Model</span>
            <select
              className="flex-1 bg-bg-inset border border-border rounded-md px-2.5 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-primary/40"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2.5">
            <span className="text-[11px] text-text-faint w-16 shrink-0">Max turns</span>
            <input
              type="number"
              className="w-20 bg-bg-inset border border-border rounded-md px-2.5 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-primary/40"
              value={maxTurns}
              onChange={(e) => setMaxTurns(parseInt(e.target.value) || 60)}
              min={1}
              max={500}
            />
          </label>
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-text-faint w-16 shrink-0">Network</span>
            <div className="flex gap-4">
              {([["none", "Unrestricted"], ["strict", "Restricted"]] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
                  <input
                    type="radio"
                    name="network"
                    checked={networkPolicy === value}
                    onChange={() => setNetworkPolicy(value)}
                    className="accent-primary"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {pendingInit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-raised border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5">
            <h3 className="text-[13px] font-semibold text-text-primary mb-1">Branch conflict</h3>
            <p className="text-[12px] text-text-muted mb-3">
              {pendingInit.conflicts.length === 1
                ? `Branch ${pendingInit.conflicts[0].branch} already exists.`
                : `${pendingInit.conflicts.length} branches already exist.`}
            </p>
            <div className="mb-4 space-y-1">
              {pendingInit.conflicts.map((c) => (
                <div key={c.id} className="text-[11px] font-mono text-text-faint bg-bg-inset rounded px-2.5 py-1.5">
                  #{c.id} — {c.branch}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-border text-text-primary hover:bg-bg-surface cursor-pointer transition-colors"
                onClick={() => resolveConflicts("reuse")}
                disabled={initMutation.isPending}
              >
                Reuse existing
              </button>
              <button
                className="flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-white hover:brightness-110 cursor-pointer transition-all disabled:opacity-40"
                onClick={() => resolveConflicts("new")}
                disabled={initMutation.isPending}
              >
                New branch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
