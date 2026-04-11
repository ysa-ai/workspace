import type { TaskStatus, ParsedLogEntry } from "./types";

// ─── Dashboard → Agent (Commands) ───────────────────────────────────────────

export const COMMANDS = [
  "init",
  "advance",
  "continue",
  "relaunch",
  "refine",
  "stop",
  "cleanup",
  "devServers",
  "openTerminal",
  "log_subscribe",
  "log_unsubscribe",
  "pickDirectory",
  "pickFile",
  "pickFileOrFolder",
  "validatePath",
  "validateProjectRoot",
  "checkIssue",
  "cloneSandbox",
  "listCredentials",
  "getCredential",
  "sync_config",
  "buildProject",
  "get_git_info",
  "detectTerminals",
] as const;
export type CommandName = (typeof COMMANDS)[number];

export interface DashboardCommand {
  type: "command";
  requestId: string;
  command: CommandName;
  payload: Record<string, unknown>;
}

// Typed payloads per command
export interface InitPayload {
  issues: number[];
}
export interface ExecutePayload {
  taskId: string;
  prompt?: string;
}
export interface FinalizePayload {
  taskId: string;
}
export interface AdvancePayload {
  taskId: string;
  transitionId: number;
  stepSlug: string;
  prompt?: string;
}
export interface ContinuePayload {
  taskId: string;
  phase: string;
}
export interface RelaunchPayload {
  taskId: string;
  phase: string;
}
export interface RefinePayload {
  taskId: string;
  phase: string;
  prompt: string;
}
export interface StopPayload {
  taskId: string;
  pid: number | null;
  phase: string;
}
export interface CleanupPayload {
  taskId: string;
  pid?: number | null;
}
export interface DevServersPayload {
  taskId: string;
  action: "start" | "stop" | "status";
}
export interface OpenTerminalPayload {
  taskId: string;
  terminalId?: string;
}
export interface LogSubscribePayload {
  taskId: string;
  phase: string;
}
export interface LogUnsubscribePayload {
  taskId: string;
}
export interface CloneSandboxPayload {
  directory: string;
  repoUrl: string;
}

// ─── Agent → Dashboard (Events) ─────────────────────────────────────────────

export interface AuthMessage {
  type: "auth";
  token: string;
  agentId: string;
  agentName: string;
}

export interface AckMessage {
  type: "ack";
  requestId: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}

export interface StatusUpdate {
  type: "status_update";
  taskId: string;
  status: Partial<TaskStatus>;
}

export interface ResultReady {
  type: "result_ready";
  taskId: string;
  data: Record<string, unknown>;
}

export interface LogChunk {
  type: "log_chunk";
  taskId: string;
  phase: string;
  entries: ParsedLogEntry[];
}

export interface Heartbeat {
  type: "heartbeat";
  timestamp: number;
}

export interface AgentConfig {
  type: "agent_config";
  config: {
    projectRoot: string;
    devServers: Array<{ name: string; cmd: string; port: number }>;
  };
}

// ─── Resource Monitoring ─────────────────────────────────────────────────────

export interface ContainerMetrics {
  name: string;
  cpu_pct: number;
  mem_mb: number;
  pids: number;
}

export interface ContainerPeak {
  name: string;
  peak_mb: number;
}

export interface ResourceMetrics {
  containers: ContainerMetrics[];
  aggregate: { count: number; total_cpu_pct: number; total_mem_mb: number };
  host: { cpu_pct: number; mem_used_mb: number; mem_total_mb: number; mem_pct: number; disk_free_gb: number; mem_source: "vm" | "host" };
  capacity: { estimated_remaining: number; avg_peak_mb: number } | null;
  completed_peaks: ContainerPeak[];
  warnings: string[];
}

export interface ResourceUpdate {
  type: "resource_update";
  containers: ContainerMetrics[];
  aggregate: ResourceMetrics["aggregate"];
  host: ResourceMetrics["host"];
  capacity: ResourceMetrics["capacity"];
  completed_peaks: ContainerPeak[];
  warnings: string[];
}

export interface BuildProgress {
  type: "build_progress";
  projectId: string;
  step: string;
  progress: number;
}

// ─── Union types ─────────────────────────────────────────────────────────────

export type AgentMessage =
  | AuthMessage
  | AckMessage
  | StatusUpdate
  | ResultReady
  | LogChunk
  | Heartbeat
  | AgentConfig
  | ResourceUpdate
  | BuildProgress;

export type DashboardMessage = DashboardCommand;
