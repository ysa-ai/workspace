import { useState, useEffect, useRef } from "react";
import { trpc } from "../trpc";
import { useToast } from "./Toast";

type NetworkPolicy = "none" | "strict" | null;

interface StepModule {
  name: string;
  prompt: string;
  config?: Record<string, unknown>;
}

interface StepForm {
  name: string;
  slug: string;
  toolPreset: string; // "readonly" | "readwrite"
  networkPolicy: NetworkPolicy;
  modules: StepModule[];
  promptTemplate: string;
  autoAdvance: boolean;
  toolAllowlist: string[] | null;
}

// Built-in module catalog — name, label, description, default prompt, default config
const BUILTIN_MODULES: { name: string; label: string; description: string; defaultPrompt: string; defaultConfig?: Record<string, unknown> }[] = [
  {
    name: "fetch_issue",
    label: "Fetch Issue",
    description: "Fetches the issue title, body, and discussion thread before the step begins.",
    defaultPrompt: "",
  },
  {
    name: "plan",
    label: "Plan",
    description: "Agent writes a structured plan document shown in the dashboard.",
    defaultPrompt: `## Plan Module

Write a comprehensive plan document for the work required by this issue.

### Plan format

Your plan should include:
- **Title**: A concise title summarising the work
- **Summary**: Brief description of the approach and why it was chosen
- **Implementation steps**: Numbered, concrete steps to complete the work
- **Risks**: Any risks, edge cases, or dependencies to be aware of`,
  },
  {
    name: "delivery",
    label: "Delivery",
    description: "Agent commits changes, pushes the branch, and optionally opens a PR/MR.",
    defaultConfig: { createPR: true },
    defaultPrompt: `## Delivery Module

After implementing the changes, push your work:

1. **Stage files** — use \`git add <specific files>\` (never \`git add .\`)
2. **Commit** — write a clear, descriptive message
3. **Rebase** — run \`git fetch origin && git rebase origin/main\` before pushing
4. **Push** — use the \`{MCP_PUSH_FILES}\` MCP tool (not \`git push\`)
5. **Create {PR_TERM}** — use the \`{MCP_CREATE_PR}\` MCP tool targeting the default branch`,
  },
  {
    name: "issue_update",
    label: "Issue Update",
    description: "Agent posts a summary comment on the issue and updates labels or status.",
    defaultConfig: { postComment: true, closeIssue: false, addLabels: [], removeLabels: [] },
    defaultPrompt: `## Issue Update Module

Post a summary comment on the issue and update its metadata to reflect the completed work.

### Steps

1. **Post a comment** — Use \`{MCP_CREATE_COMMENT}\` with \`{MCP_COMMENTS_ARGS}\` to add a comment summarising what was done, linking to the {PR_TERM} if one was created, and noting any follow-ups.

2. **Update metadata** — Apply any label or assignee changes specified in the configuration block.

### Rules

- Be concise — the {PR_TERM_SHORT} itself has the implementation details
- Do not close the issue unless explicitly instructed`,
  },
  {
    name: "unit_tests",
    label: "Unit Tests",
    description: "Agent runs unit tests and reports pass/fail results in the step result.",
    defaultPrompt: "Write unit tests for the changes made in this step. Run them and report the results with per-test pass/fail status.",
  },
  {
    name: "manual_qa",
    label: "Manual QA",
    description: "Agent generates a manual QA checklist; a human can tick items off in the dashboard.",
    defaultPrompt: "Generate a manual QA checklist covering the main user-facing scenarios affected by this change. Each item should be a specific, actionable verification step.",
  },
];

const defaultStep = (): StepForm => ({
  name: "",
  slug: "",
  toolPreset: "readonly",
  networkPolicy: "strict",
  modules: [{ name: "__prompt__", prompt: "" }],
  promptTemplate: "",
  autoAdvance: false,
  toolAllowlist: null,
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-lg bg-bg-surface border border-border">
      <svg className="shrink-0 mt-0.5 text-text-muted" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
      </svg>
      <span className="text-[12px] text-text-muted leading-relaxed">{children}</span>
    </div>
  );
}

function containerModeFromPreset(preset: string): "readonly" | "readwrite" {
  return preset === "readonly" ? "readonly" : "readwrite";
}


const NETWORK_POLICY_LABELS: Record<string, { label: string; description: string }> = {
  none: {
    label: "Full internet",
    description: "No restrictions — agent can make any HTTP/HTTPS request.",
  },
  strict: {
    label: "Restricted",
    description: "MITM proxy enforced: GET-only, no request bodies, rate-limited. Prevents data exfiltration.",
  },
};

const INPUT_CLS = "w-full bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all";


const BUILTIN_PRESETS: { name: string; description: string }[] = [
  { name: "readonly", description: "No file changes, no git commits or pushes. Analysis only." },
  { name: "readwrite", description: "Full git access — agent can commit and push changes." },
];

function ToolPresetSelector({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Tool preset</label>
      <div className="space-y-1.5">
        {BUILTIN_PRESETS.map((p) => {
          const isSelected = p.name === value;
          return (
            <div
              key={p.name}
              className={`rounded-lg border transition-colors cursor-pointer ${isSelected ? "border-primary/40 bg-primary/5" : "border-border bg-bg-surface"}`}
              onClick={() => onChange(p.name)}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors ${isSelected ? "border-primary bg-primary" : "border-border"}`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-[13px] font-medium ${isSelected ? "text-primary" : "text-text-primary"}`}>{p.name}</span>
                  <p className="text-[12px] text-text-muted mt-0.5">{p.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface WorkflowBuilderProps {
  workflowId: number | null; // null = create new
  onSaved: () => void;
  onClose: () => void;
}

export function WorkflowBuilder({ workflowId, onSaved, onClose }: WorkflowBuilderProps) {
  const showToast = useToast();
  const utils = trpc.useUtils();

  const [name, setName] = useState("New Workflow");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepForm[]>([defaultStep()]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const dragModuleIdx = useRef<number | null>(null);
  const [dragOverModuleIdx, setDragOverModuleIdx] = useState<number | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set());

  const existingWf = trpc.workflows.get.useQuery(
    { workflowId: workflowId! },
    { enabled: workflowId !== null },
  );

  useEffect(() => {
    if (!existingWf.data) return;
    const wf = existingWf.data;
    setName(wf.name);
    setDescription(wf.description ?? "");
    setSteps(
      wf.steps.map((s) => ({
        name: s.name,
        slug: s.slug,
        toolPreset: s.tool_preset ?? "readonly",
        networkPolicy: (s.network_policy as NetworkPolicy) ?? "none",
        modules: Array.isArray(s.modules)
          ? s.modules.map((m: any) => typeof m === "string" ? { name: m, prompt: "" } : m)
          : [],
        promptTemplate: s.prompt_template ?? "",
        autoAdvance: !!s.auto_advance,
        toolAllowlist: Array.isArray(s.tool_allowlist) ? s.tool_allowlist : null,
      })),
    );
    setIsDirty(false);
  }, [existingWf.data]);


  const createMutation = trpc.workflows.create.useMutation({
    onSuccess: (wf) => {
      utils.workflows.invalidate();
      showToast(`Workflow "${wf.name}" created`, "success");
      setIsDirty(false);
      onSaved();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const updateMutation = trpc.workflows.update.useMutation({
    onSuccess: (wf) => {
      utils.workflows.invalidate();
      showToast(`Workflow "${wf.name}" saved`, "success");
      setIsDirty(false);
      onSaved();
    },
    onError: (err) => showToast(err.message, "error"),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function buildPayload() {
    const stepsPayload = steps.map((s, i) => ({
      name: s.name,
      slug: s.slug || slugify(s.name) || `step_${i + 1}`,
      position: i,
      promptTemplate: s.promptTemplate,
      toolPreset: s.toolPreset,
      toolAllowlist: s.toolAllowlist && s.toolAllowlist.length > 0 ? s.toolAllowlist : null,
      containerMode: containerModeFromPreset(s.toolPreset),
      modules: s.modules,
      networkPolicy: s.networkPolicy,
      autoAdvance: s.autoAdvance,
    }));

    // Linear transitions: each step → next, last → null
    const transitionsPayload = steps.map((_, i) => ({
      fromStepIndex: i,
      toStepIndex: i < steps.length - 1 ? i + 1 : null,
      label: i < steps.length - 1 ? `→ ${steps[i + 1].name || `Step ${i + 2}`}` : null,
      condition: null,
      isDefault: true,
      position: 0,
    }));

    return { name, description: description.trim() || null, steps: stepsPayload, transitions: transitionsPayload };
  }

  function handleSave() {
    const payload = buildPayload();
    if (workflowId !== null) {
      updateMutation.mutate({ workflowId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function addStep() {
    setSteps((s) => [...s, defaultStep()]);
    setSelectedIdx(steps.length);
    setIsDirty(true);
  }

  function removeStep(idx: number) {
    if (steps.length === 1) return;
    setSteps((s) => s.filter((_, i) => i !== idx));
    setSelectedIdx(Math.min(selectedIdx, steps.length - 2));
    setIsDirty(true);
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= steps.length) return;
    setSteps((s) => {
      const copy = [...s];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
    setSelectedIdx(next);
    setIsDirty(true);
  }

  function patchStep(idx: number, patch: Partial<StepForm>) {
    setSteps((s) => s.map((step, i) => (i === idx ? { ...step, ...patch } : step)));
    setIsDirty(true);
  }

  const current = steps[selectedIdx];

  if (existingWf.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-faint text-[13px]">
        Loading workflow...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
        <button
          className="text-text-muted hover:text-text-primary cursor-pointer p-0.5 rounded hover:bg-bg-surface transition-colors"
          onClick={onClose}
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <input
            className="bg-bg-surface text-lg font-bold outline-none border border-border rounded-lg px-2.5 py-1 hover:border-border-bright focus:border-primary/40 transition-colors w-full"
            value={name}
            onChange={(e) => { setName(e.target.value); setIsDirty(true); }}
            placeholder="Workflow name"
          />
          <input
            className="bg-transparent text-[12px] text-text-muted outline-none border-b border-transparent hover:border-border focus:border-primary/40 transition-colors w-full py-0.5"
            value={description}
            onChange={(e) => { setDescription(e.target.value); setIsDirty(true); }}
            placeholder="Description (optional)"
          />
        </div>
        <button
          className="shrink-0 px-4 py-1.5 bg-primary text-white rounded-lg text-[13px] font-semibold hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSave}
          disabled={isPending || !name.trim()}
        >
          {isPending ? "Saving..." : isDirty ? "Save*" : "Save"}
        </button>
      </div>

      {/* Body: two-panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left: step list */}
        <div className="w-64 shrink-0 border-r border-border flex flex-col bg-bg-raised">
          <div className="flex-1 overflow-y-auto py-2">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`group flex items-center gap-2 px-3 py-3 cursor-pointer transition-colors ${
                  i === selectedIdx
                    ? "bg-primary/10 border-r-2 border-primary"
                    : "hover:bg-bg-surface"
                }`}
                onClick={() => { setSelectedIdx(i); setExpandedModules(new Set()); }}
              >
                <span className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full border border-border text-[12px] font-mono text-text-faint bg-bg-inset">
                  {i + 1}
                </span>
                <span className={`flex-1 min-w-0 text-[13px] truncate ${i === selectedIdx ? "text-primary font-medium" : "text-text-primary"}`}>
                  {step.name || <span className="text-text-faint italic">Unnamed</span>}
                </span>
                <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="p-1 rounded hover:bg-bg-surface text-text-faint hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default"
                    onClick={(e) => { e.stopPropagation(); moveStep(i, -1); }}
                    disabled={i === 0}
                    title="Move up"
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6" /></svg>
                  </button>
                  <button
                    className="p-1 rounded hover:bg-bg-surface text-text-faint hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default"
                    onClick={(e) => { e.stopPropagation(); moveStep(i, 1); }}
                    disabled={i === steps.length - 1}
                    title="Move down"
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  <button
                    className="p-1 rounded hover:bg-err-bg text-text-faint hover:text-err cursor-pointer disabled:opacity-30 disabled:cursor-default"
                    onClick={(e) => { e.stopPropagation(); removeStep(i); }}
                    disabled={steps.length === 1}
                    title="Remove step"
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border shrink-0">
            <button
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-colors cursor-pointer"
              onClick={addStep}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              Add step
            </button>
          </div>
        </div>

        {/* Right: step editor */}
        {current && (
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
            <div className="w-full p-6 pb-32 space-y-5">

            {/* Row 1: name + slug */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Step name</label>
                <input
                  className={INPUT_CLS}
                  value={current.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const currentSlugMatchesName = !current.slug || current.slug === slugify(current.name);
                    patchStep(selectedIdx, {
                      name,
                      ...(currentSlugMatchesName ? { slug: slugify(name) } : {}),
                    });
                  }}
                  placeholder="Analyze"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Slug</label>
                <input
                  className={`${INPUT_CLS} font-mono`}
                  value={current.slug}
                  onChange={(e) => patchStep(selectedIdx, { slug: e.target.value })}
                  placeholder="analyze"
                />
              </div>
            </div>

            {/* Row 2: preset + network side by side, then modules full width */}
            <div className="border-t border-border pt-5 space-y-5">
              {/* Preset + network on one line */}
              <div className="grid grid-cols-3 gap-6 items-start">
                <div className="col-span-2">
                <ToolPresetSelector
                  value={current.toolPreset}
                  onChange={(name) => patchStep(selectedIdx, { toolPreset: name })}
                />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Network policy</label>
                  <div className="flex gap-1">
                    {(["none", "strict"] as NetworkPolicy[]).map((p) => (
                      <button
                        key={String(p)}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors cursor-pointer ${
                          current.networkPolicy === p
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border text-text-muted hover:border-border-bright hover:text-text-primary"
                        }`}
                        onClick={() => patchStep(selectedIdx, { networkPolicy: p })}
                      >
                        {NETWORK_POLICY_LABELS[String(p)].label}
                      </button>
                    ))}
                  </div>
                  <Hint>{NETWORK_POLICY_LABELS[current.networkPolicy ?? "none"].description}</Hint>
                </div>
              </div>

              {/* Tool restrictions */}
              {(() => {
                const mcpEnabled = current.toolAllowlist?.some((t) => t.startsWith("mcp__")) ?? false;
                const mcpSpecificTools = current.toolAllowlist?.filter((t) => t.startsWith("mcp__") && t !== "mcp__*").join(", ") ?? "";
                const baseToolsStr = current.toolAllowlist?.filter((t) => !t.startsWith("mcp__")).join(", ") ?? "";

                function applyAllowlist(mcpOn: boolean, mcpSpecific: string, baseTools: string) {
                  const base = baseTools.split(",").map((t) => t.trim()).filter(Boolean);
                  const mcp: string[] = [];
                  if (mcpOn) {
                    const specific = mcpSpecific.split(",").map((t) => t.trim()).filter((t) => t.startsWith("mcp__"));
                    mcp.push(...(specific.length > 0 ? specific : ["mcp__*"]));
                  }
                  const all = [...base, ...mcp];
                  patchStep(selectedIdx, { toolAllowlist: all.length > 0 ? all : null });
                }

                return (
                  <div className="space-y-3">
                    <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Tool restrictions</label>
                    <div>
                      <label className="block text-[11px] text-text-muted mb-1">Base tool restriction <span className="text-text-faint">(optional — comma-separated, e.g. <code className="font-mono">WebSearch,WebFetch,Read</code>)</span></label>
                      <input
                        className={INPUT_CLS}
                        value={baseToolsStr}
                        onChange={(e) => applyAllowlist(mcpEnabled, mcpSpecificTools, e.target.value)}
                        placeholder="Leave empty to allow all tools"
                      />
                    </div>
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer mb-2">
                        <input
                          type="checkbox"
                          checked={mcpEnabled}
                          onChange={(e) => applyAllowlist(e.target.checked, mcpSpecificTools, baseToolsStr)}
                          className="accent-primary"
                        />
                        <span className="text-[13px] text-text-primary font-medium">Enable MCP tools</span>
                      </label>
                      {mcpEnabled && (
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">Restrict to specific MCP tools <span className="text-text-faint">(optional — comma-separated <code className="font-mono">mcp__server__tool</code> names)</span></label>
                          <input
                            className={INPUT_CLS}
                            value={mcpSpecificTools}
                            onChange={(e) => applyAllowlist(true, e.target.value, baseToolsStr)}
                            placeholder="Leave empty to allow all MCP tools"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Modules full width */}
              <div>
              <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1">Execution order</label>
              <Hint>Drag to reorder. The step prompt is the core task — modules are add-ons that run around it.</Hint>
              <div className="mt-3">
                {current.modules.map((mod, modIdx) => {
                  const builtin = BUILTIN_MODULES.find((b) => b.name === mod.name);
                  const showOrder = current.modules.length > 1;
                  const isDragOver = dragOverModuleIdx === modIdx;
                  const isPrompt = mod.name === "__prompt__";
                  return (
                    <div key={modIdx}>
                      {showOrder && modIdx > 0 && (
                        <div className="flex justify-center py-1.5">
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-text-muted"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                        </div>
                      )}
                      <div
                        draggable
                        onDragStart={() => { dragModuleIdx.current = modIdx; }}
                        onDragOver={(e) => { e.preventDefault(); setDragOverModuleIdx(modIdx); }}
                        onDrop={() => {
                          const from = dragModuleIdx.current;
                          if (from === null || from === modIdx) return;
                          const mods = [...current.modules];
                          const [removed] = mods.splice(from, 1);
                          mods.splice(modIdx, 0, removed);
                          patchStep(selectedIdx, { modules: mods });
                          dragModuleIdx.current = null;
                          setDragOverModuleIdx(null);
                        }}
                        onDragEnd={() => { dragModuleIdx.current = null; setDragOverModuleIdx(null); }}
                        className={`border rounded-lg transition-colors ${isDragOver ? "border-primary/60" : "border-primary/20 bg-primary/5"}`}
                      >
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          {/* drag handle */}
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="shrink-0 text-text-muted cursor-grab opacity-50 hover:opacity-100">
                            <circle cx="4" cy="3" r="1"/><circle cx="8" cy="3" r="1"/>
                            <circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/>
                            <circle cx="4" cy="9" r="1"/><circle cx="8" cy="9" r="1"/>
                          </svg>
                          {showOrder && (
                            <span className="text-[11px] font-bold text-text-muted w-4 shrink-0 text-center">{modIdx + 1}</span>
                          )}
                          <div className="flex-1 min-w-0">
                            {isPrompt
                              ? <span className="text-[13px] font-medium text-primary">Step prompt</span>
                              : <span className="text-[13px] font-medium text-text-primary">{builtin?.label ?? mod.name}</span>
                            }
                            {isPrompt
                              ? <p className="text-[12px] text-text-muted mt-0.5">Core task instructions for this step.</p>
                              : builtin && <p className="text-[12px] text-text-muted mt-0.5">{builtin.description}</p>
                            }
                          </div>
                          {!isPrompt && (
                            <button
                              className="shrink-0 p-1 rounded hover:bg-err-bg text-text-muted hover:text-err transition-colors cursor-pointer"
                              onClick={() => patchStep(selectedIdx, { modules: current.modules.filter((_, i) => i !== modIdx) })}
                              title="Remove module"
                            >
                              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </div>

                        {/* __prompt__ textarea */}
                        {isPrompt && (
                          <div className="px-3 pb-3 border-t border-border/50 pt-2">
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Instructions</label>
                              <details className="relative">
                                <summary className="text-[12px] text-text-muted cursor-pointer hover:text-text-primary select-none list-none flex items-center gap-1">
                                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                                  Variables
                                </summary>
                                <div className="absolute right-0 top-6 z-10 w-72 p-2.5 bg-bg-raised rounded-lg border border-border text-[12px] font-mono shadow-lg space-y-1">
                                  {[
                                    ["{ISSUE_ID}", "Issue ID"],
                                    ["{ISSUE_URL}", "URL of the issue"],
                                    ["{ISSUE_TITLE}", "Issue title"],
                                    ["{ISSUE_BODY}", "Issue body / description"],
                                    ["{PROJECT_ROOT}", "Absolute path to the workspace"],
                                    ["{BRANCH}", "Git branch name"],
                                    ["{DASHBOARD_URL}", "Dashboard base URL"],
                                    ["{PREV_STEP_RESULT}", "Result from the previous step (if any)"],
                                  ].map(([v, desc]) => (
                                    <div key={v} className="flex gap-3">
                                      <span className="text-primary shrink-0">{v}</span>
                                      <span className="text-text-muted">{desc}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </div>
                            <textarea
                              className={`${INPUT_CLS} min-h-[320px] resize-y font-mono text-[12px]`}
                              value={current.promptTemplate}
                              onChange={(e) => patchStep(selectedIdx, { promptTemplate: e.target.value })}
                              placeholder="You are a coding assistant. Your task is to..."
                            />
                          </div>
                        )}

                        {/* issue_update config */}
                        {mod.name === "issue_update" && (
                          <div className="px-3 pb-3 border-t border-border pt-2 space-y-2">
                            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Configuration</label>
                            <div className="flex flex-col gap-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={(mod.config?.postComment as boolean) !== false}
                                  onChange={(e) => {
                                    const updated = current.modules.map((m, i) => i === modIdx ? { ...m, config: { ...m.config, postComment: e.target.checked } } : m);
                                    patchStep(selectedIdx, { modules: updated });
                                  }} className="rounded" />
                                <span className="text-[12px] text-text-primary">Post a comment on the issue</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={!!(mod.config?.closeIssue)}
                                  onChange={(e) => {
                                    const updated = current.modules.map((m, i) => i === modIdx ? { ...m, config: { ...m.config, closeIssue: e.target.checked } } : m);
                                    patchStep(selectedIdx, { modules: updated });
                                  }} className="rounded" />
                                <span className="text-[12px] text-text-primary">Close the issue</span>
                              </label>
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">Add labels (comma-separated)</label>
                                <input type="text" className={`${INPUT_CLS} text-[12px]`}
                                  value={((mod.config?.addLabels as string[]) ?? []).join(", ")}
                                  onChange={(e) => {
                                    const labels = e.target.value.split(",").map((l) => l.trim()).filter(Boolean);
                                    const updated = current.modules.map((m, i) => i === modIdx ? { ...m, config: { ...m.config, addLabels: labels } } : m);
                                    patchStep(selectedIdx, { modules: updated });
                                  }}
                                  placeholder="e.g. in-review, done" />
                              </div>
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">Remove labels (comma-separated)</label>
                                <input type="text" className={`${INPUT_CLS} text-[12px]`}
                                  value={((mod.config?.removeLabels as string[]) ?? []).join(", ")}
                                  onChange={(e) => {
                                    const labels = e.target.value.split(",").map((l) => l.trim()).filter(Boolean);
                                    const updated = current.modules.map((m, i) => i === modIdx ? { ...m, config: { ...m.config, removeLabels: labels } } : m);
                                    patchStep(selectedIdx, { modules: updated });
                                  }}
                                  placeholder="e.g. in-progress" />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* delivery config */}
                        {mod.name === "delivery" && (
                          <div className="px-3 pb-3 border-t border-border pt-2">
                            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Configuration</label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={(mod.config?.createPR as boolean) !== false}
                                onChange={(e) => {
                                  const updated = current.modules.map((m, i) => i === modIdx ? { ...m, config: { ...m.config, createPR: e.target.checked } } : m);
                                  patchStep(selectedIdx, { modules: updated });
                                }} className="rounded" />
                              <span className="text-[12px] text-text-primary">Create a PR / MR after pushing</span>
                            </label>
                          </div>
                        )}

                        {(mod.prompt.trim() || expandedModules.has(modIdx)) ? (
                          <div className="px-3 pb-3 border-t border-border pt-2">
                            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Additional instructions</label>
                            <textarea
                              className={`${INPUT_CLS} min-h-[160px] resize-y font-mono text-[12px]`}
                              value={mod.prompt}
                              autoFocus={!mod.prompt.trim()}
                              onChange={(e) => {
                                const updated = current.modules.map((m, i) => i === modIdx ? { ...m, prompt: e.target.value } : m);
                                patchStep(selectedIdx, { modules: updated });
                              }}
                              placeholder="Optional. Appended after the module's built-in behavior — use to add project-specific conventions or constraints."
                            />
                          </div>
                        ) : (
                          <div className="px-3 pb-2.5 border-t border-border pt-2">
                            <button
                              className="text-[12px] text-text-faint hover:text-text-muted transition-colors cursor-pointer flex items-center gap-1"
                              onClick={() => setExpandedModules((s) => new Set([...s, modIdx]))}
                            >
                              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                              Additional instructions
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Add module */}
              {BUILTIN_MODULES.filter((b) => b.name !== "__prompt__" && !current.modules.some((m) => m.name === b.name)).length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {BUILTIN_MODULES.filter((b) => b.name !== "__prompt__" && !current.modules.some((m) => m.name === b.name)).map((b) => (
                    <button
                      key={b.name}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-colors cursor-pointer"
                      onClick={() => patchStep(selectedIdx, {
                        modules: [...current.modules, { name: b.name, prompt: b.defaultPrompt, config: b.defaultConfig }],
                      })}
                    >
                      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                      {b.label}
                    </button>
                  ))}
                </div>
              )}
              </div>
            </div>

            {/* Auto-advance / Auto-archive */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={current.autoAdvance}
                onChange={(e) => patchStep(selectedIdx, { autoAdvance: e.target.checked })}
                className="accent-primary"
              />
              <div>
                {selectedIdx === steps.length - 1 ? (
                  <>
                    <span className="text-[13px] text-text-primary font-medium">Auto-archive</span>
                    <p className="text-[12px] text-text-muted mt-0.5">Automatically archive the issue when this step completes successfully</p>
                  </>
                ) : (
                  <>
                    <span className="text-[13px] text-text-primary font-medium">Auto-advance</span>
                    <p className="text-[12px] text-text-muted mt-0.5">Automatically move to the next step when this step completes successfully</p>
                  </>
                )}
              </div>
            </label>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
