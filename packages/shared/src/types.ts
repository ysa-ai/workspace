export type Phase = string;

export const STATUSES = [
  "starting",
  "running",
  "step_done",
  "failed",
  "stopped",
  "cleaned_up",
] as const;
export type Status = (typeof STATUSES)[number];

export interface TaskStatus {
  task_id: number;
  step: string;
  status: Status;
  started_at: string;
  finished_at: string | null;
  pid: number | null;
  session_id: string | null;
  plan_summary: string | null;
  mr_url: string | null;
  error: string | null;
  failure_reason: "max_turns" | "infrastructure" | "agent_aborted" | null;
  // Workflow-aware fields (populated when issue has a workflow state)
  currentStepSlug?: string;
  currentStepName?: string;
  stepHistory?: StepHistoryEntry[];
}

export interface StepHistoryEntry {
  stepId: number;
  slug: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "failed";
}

export interface ParsedLogEntry {
  type: "system" | "assistant" | "tool_call" | "result" | "raw" | "network" | "progress" | "section";
  icon?: string;
  text: string;
  tool?: string;
  tool_use_id?: string;
  output?: string;
  session_id?: string;
  cost?: number;
  turns?: number;
  ts?: number;
}

// ─── Workflow types ───────────────────────────────────────────────────────────

export interface StepModule {
  name: string;
  prompt: string;
  config?: Record<string, unknown>;
}

export interface WorkflowStep {
  id: number;
  slug: string;
  name: string;
  position: number;
  toolPreset: "readonly" | "readwrite" | "post-execution" | "custom";
  toolAllowlist: string[] | null;
  containerMode: "readonly" | "readwrite";
  modules: StepModule[];
  networkPolicy: "none" | "strict" | null;
  autoAdvance: boolean;
  promptTemplate: string;
}

export interface WorkflowTransition {
  id: number;
  fromStepId: number;
  toStepId: number | null;
  label: string | null;
  condition: TransitionCondition | null;
  isDefault: boolean;
  position: number;
}

export interface TransitionCondition {
  field: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "exists" | "not_exists";
  value: unknown;
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  steps: WorkflowStep[];
  transitions: WorkflowTransition[];
}
