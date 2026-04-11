import { z } from "zod";
import { STATUSES } from "./types";
import { COMMANDS } from "./protocol";

// ─── Shared ──────────────────────────────────────────────────────────────────

const statusSchema = z.enum(STATUSES);

export const taskStatusSchema = z.object({
  task_id: z.number(),
  phase: z.string(),
  status: statusSchema,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  pid: z.number().nullable(),
  session_id: z.string().nullable(),
  plan_summary: z.string().nullable(),
  mr_url: z.string().nullable(),
  error: z.string().nullable(),
});

export const parsedLogEntrySchema = z.object({
  type: z.enum(["system", "assistant", "tool_call", "result", "raw"]),
  icon: z.string().optional(),
  text: z.string(),
  tool: z.string().optional(),
  session_id: z.string().optional(),
  cost: z.number().optional(),
  turns: z.number().optional(),
});

// ─── Dashboard → Agent ──────────────────────────────────────────────────────

export const dashboardCommandSchema = z.object({
  type: z.literal("command"),
  requestId: z.string(),
  command: z.enum(COMMANDS),
  payload: z.record(z.string(), z.unknown()),
});

export const initPayloadSchema = z.object({
  issues: z.array(z.number()),
});

export const executePayloadSchema = z.object({
  taskId: z.string(),
  prompt: z.string().optional(),
});

export const finalizePayloadSchema = z.object({
  taskId: z.string(),
});

export const advancePayloadSchema = z.object({
  taskId: z.string(),
  transitionId: z.number(),
  stepSlug: z.string(),
  prompt: z.string().optional(),
});

export const continuePayloadSchema = z.object({
  taskId: z.string(),
  phase: z.string(),
});

export const refinePayloadSchema = z.object({
  taskId: z.string(),
  phase: z.string(),
  prompt: z.string(),
});

export const stopPayloadSchema = z.object({
  taskId: z.string(),
  pid: z.number().nullable(),
  phase: z.string(),
});

export const cleanupPayloadSchema = z.object({
  taskId: z.string(),
  pid: z.number().nullable().optional(),
});

export const devServersPayloadSchema = z.object({
  taskId: z.string(),
  action: z.enum(["start", "stop", "status"]),
});

export const openTerminalPayloadSchema = z.object({
  taskId: z.string(),
});

export const logSubscribePayloadSchema = z.object({
  taskId: z.string(),
  phase: z.string(),
});

export const logUnsubscribePayloadSchema = z.object({
  taskId: z.string(),
});

// ─── Agent → Dashboard ──────────────────────────────────────────────────────

export const authMessageSchema = z.object({
  type: z.literal("auth"),
  token: z.string(),
  agentId: z.string(),
  agentName: z.string(),
});

export const ackMessageSchema = z.object({
  type: z.literal("ack"),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  data: z.unknown().optional(),
});

export const statusUpdateSchema = z.object({
  type: z.literal("status_update"),
  taskId: z.string(),
  status: taskStatusSchema.partial(),
});

export const resultReadySchema = z.object({
  type: z.literal("result_ready"),
  taskId: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const logChunkSchema = z.object({
  type: z.literal("log_chunk"),
  taskId: z.string(),
  phase: z.string(),
  entries: z.array(parsedLogEntrySchema),
});

export const heartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  timestamp: z.number(),
});

export const agentConfigSchema = z.object({
  type: z.literal("agent_config"),
  config: z.object({
    projectRoot: z.string(),
    devServers: z.array(
      z.object({
        name: z.string(),
        cmd: z.string(),
        port: z.number(),
      }),
    ),
  }),
});

export const agentMessageSchema = z.discriminatedUnion("type", [
  authMessageSchema,
  ackMessageSchema,
  statusUpdateSchema,
  resultReadySchema,
  logChunkSchema,
  heartbeatSchema,
  agentConfigSchema,
]);

export const dashboardMessageSchema = dashboardCommandSchema;
