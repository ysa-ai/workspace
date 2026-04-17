import type { ServerWebSocket } from "bun";
import { randomBytes } from "crypto";
import { setResourceMetrics } from "../lib/resources";
import { db } from "../db";
import { submitTokens, projects, tasks } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { verifyAccessToken } from "../lib/auth";
import { log } from "../logger";
import { getProjectConfig } from "../lib/project-bootstrap";
import { updateBuildProgress } from "../lib/build-manager";
import { config } from "../config";
import { telemetry } from "../lib/telemetry";
import type { CommandName, AckMessage } from "@ysa-ai/shared";
import { handleStatusUpdate } from "./status-update";
import { handleAgentRequest } from "./agent-commands";

function semverAtLeast(version: string, min: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const [ma = 0, mi = 0, pa = 0] = parse(version);
  const [mb = 0, mib = 0, pb = 0] = parse(min);
  if (ma !== mb) return ma > mb;
  if (mi !== mib) return mi > mib;
  return pa >= pb;
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

let agentWs: ServerWebSocket<unknown> | null = null;
let agentUserId: number | null = null;
const authenticatedWs = new WeakSet<ServerWebSocket<unknown>>();

const pendingAcks = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: Error) => void; timer: Timer }
>();

export function getAgentWs(): ServerWebSocket<unknown> | null { return agentWs; }
export function isAgentConnected(): boolean { return agentWs !== null; }
export function getAgentUserId(): number | null { return agentUserId; }

export function registerPendingAck(
  requestId: string,
  resolve: (data: any) => void,
  reject: (err: Error) => void,
  timeoutMs = 30000,
) {
  const timer = setTimeout(() => {
    pendingAcks.delete(requestId);
    reject(new Error(`Command timed out (requestId: ${requestId})`));
  }, timeoutMs);
  pendingAcks.set(requestId, { resolve, reject, timer });
}

let _cmdCounter = 0;

export function sendAgentCommand(
  command: CommandName,
  payload: Record<string, unknown> = {},
  timeoutMs = 30000,
): Promise<AckMessage> {
  if (!agentWs) throw new Error("Agent not connected");
  const requestId = `cmd_${++_cmdCounter}_${Date.now()}`;
  return new Promise<AckMessage>((resolve, reject) => {
    registerPendingAck(requestId, resolve, reject, timeoutMs);
    agentWs!.send(JSON.stringify({ type: "command", requestId, command, payload }));
  });
}

export function disconnectAgent(): void {
  if (agentWs) {
    agentWs.close(4401, "Logged out");
    agentWs = null;
  }
}

export async function pushSyncConfig(projectIds?: string[]): Promise<void> {
  if (!agentWs || agentUserId === null) return;
  try {
    const rows = projectIds
      ? await db.select().from(projects).where(inArray(projects.project_id, projectIds))
      : await db.select().from(projects);
    const configs: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        const cfg = await getProjectConfig(row.project_id, agentUserId ?? undefined);
        const { llmProviderKeys: _k, issueSourceToken: _t, codeRepoToken: _c, ...safe } = cfg as any;
        configs[row.project_id] = safe;
      } catch { /* skip */ }
    }
    if (Object.keys(configs).length === 0) return;
    const requestId = `sync_${Date.now()}`;
    agentWs.send(JSON.stringify({ type: "command", requestId, command: "sync_config", payload: { configs } }));
  } catch (err) {
    log.warn("pushSyncConfig failed:", err);
  }
}

export const wsHandler = {
  open(_ws: ServerWebSocket<unknown>) {
    log.info("Agent WebSocket connection pending authentication");
  },

  async message(ws: ServerWebSocket<unknown>, data: string | Buffer) {
    try {
      const msg = JSON.parse(typeof data === "string" ? data : data.toString());

      if (!authenticatedWs.has(ws)) {
        if (msg.type === "auth" && typeof msg.token === "string") {
          try {
            const agentVersion = typeof msg.version === "string" ? msg.version : null;
            if (!agentVersion || !semverAtLeast(agentVersion, config.minAgentVersion)) {
              const reason = agentVersion ? `Agent version ${agentVersion} is outdated.` : "Agent version missing.";
              log.warn(`${reason} Minimum required: ${config.minAgentVersion} — rejecting`);
              ws.send(JSON.stringify({ type: "error", code: "upgrade_required", message: `${reason} Please upgrade: brew upgrade ysa-ai/tap/ysa-agent` }));
              ws.close(4426, "Upgrade required");
              return;
            }
            const payload = await verifyAccessToken(msg.token);
            agentUserId = parseInt(payload.sub);
            authenticatedWs.add(ws);
            agentWs = ws;
            log.info(`Agent authenticated via WebSocket${agentVersion ? ` (v${agentVersion})` : ""}`);
            telemetry("agent.connected", agentVersion ? { version: agentVersion } : {}).catch(() => {});
            pushSyncConfig().catch(() => {});
          } catch {
            log.warn("Agent WebSocket auth failed — closing connection");
            ws.close(4401, "Unauthorized");
          }
        } else {
          log.warn("Agent WebSocket sent non-auth message before authenticating — closing");
          ws.close(4401, "Unauthorized");
        }
        return;
      }

      switch (msg.type) {
        case "ack": {
          const pending = pendingAcks.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingAcks.delete(msg.requestId);
            if (msg.ok) pending.resolve(msg);
            else pending.reject(new Error(msg.error || "Command failed"));
          }
          break;
        }
        case "status_update":
          await handleStatusUpdate(String(msg.taskId), msg.status as Record<string, unknown>);
          break;
        case "heartbeat":
          break;
        case "resource_update":
          await setResourceMetrics({
            containers: msg.containers,
            aggregate: msg.aggregate,
            host: msg.host,
            completed_peaks: msg.completed_peaks ?? [],
            warnings: msg.warnings,
          });
          break;
        case "request_submit_token": {
          const token = randomBytes(32).toString("hex");
          const hash = await sha256(token);
          await db.delete(submitTokens).where(and(eq(submitTokens.task_id, msg.taskId), eq(submitTokens.phase, msg.phase)));
          await db.insert(submitTokens).values({
            task_id: msg.taskId,
            project_id: msg.projectId,
            phase: msg.phase,
            token_hash: hash,
            expires_at: Date.now() + 4 * 60 * 60 * 1000,
          });
          ws.send(JSON.stringify({ type: "submit_token_issued", requestId: msg.requestId, token }));
          break;
        }
        case "cleanup_submit_token":
          await db.delete(submitTokens).where(and(eq(submitTokens.task_id, msg.taskId), eq(submitTokens.phase, msg.phase)));
          break;
        case "store_deps_volumes":
          await db.update(tasks)
            .set({ deps_cache_volumes: JSON.stringify(msg.volumes) })
            .where(eq(tasks.task_id, Number(msg.taskId)));
          break;
        case "agent_request": {
          const respond = (ok: boolean, data?: unknown, error?: string) =>
            ws.send(JSON.stringify({ type: "agent_response", requestId: msg.requestId, ok, data, error }));
          try {
            await handleAgentRequest(msg.command, msg.payload ?? {}, respond);
          } catch (err: any) {
            respond(false, undefined, err.message);
          }
          break;
        }
        case "build_progress":
          updateBuildProgress(msg.projectId, msg.step, msg.progress);
          break;
        case "agent_config":
          break;
        default:
          log.warn(`Unknown WS message type: ${msg.type}`);
      }
    } catch (err) {
      log.error("Failed to parse WS message:", err);
    }
  },

  close(ws: ServerWebSocket<unknown>) {
    if (agentWs === ws) {
      log.warn("Agent disconnected");
      agentWs = null;
      agentUserId = null;
      for (const [, pending] of pendingAcks) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Agent disconnected"));
      }
      pendingAcks.clear();
    }
    authenticatedWs.delete(ws);
  },
};
