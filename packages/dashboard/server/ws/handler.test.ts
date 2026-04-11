import { mock, describe, test, expect, beforeEach, afterEach } from "bun:test";

// ── Mocks must come before any import of the tested module ───────────────────

mock.module("../db", () => ({ db: (globalThis as any).__testDb }));

const mockPatchStatus = mock(() => Promise.resolve(null));
mock.module("../lib/status", () => ({ patchStatus: mockPatchStatus }));

const mockSetResourceMetrics = mock(() => Promise.resolve());
mock.module("../lib/resources", () => ({ setResourceMetrics: mockSetResourceMetrics }));

const mockVerifyAccessToken = mock(() => Promise.resolve({ sub: "1" }));
mock.module("../lib/auth", () => ({ verifyAccessToken: mockVerifyAccessToken }));

mock.module("../lib/project-bootstrap", () => ({
  getProjectConfig: mock(() => Promise.resolve({ llmProviderKeys: {}, issueSourceToken: null, issuesDir: "/tmp" })),
}));

mock.module("../lib/crypto", () => ({
  decrypt: mock(() => ""),
  encrypt: mock((v: string) => v),
}));

const mockConfig = { minAgentVersion: "0.1.1" };
mock.module("../config", () => ({ config: mockConfig }));

// ── Now safe to import ────────────────────────────────────────────────────────

import { wsHandler, registerPendingAck } from "./handler";
type WsHandler = typeof wsHandler;
const _wsHandler = wsHandler as WsHandler;
import { TEST_PROJECT_ID } from "../lib/test-helpers";

function makeWs() {
  const sent: string[] = [];
  const closed: Array<[number, string]> = [];
  return {
    send: (data: string) => { sent.push(data); },
    close: (code = 0, reason = "") => { closed.push([code, reason]); },
    sent,
    closed,
  } as any;
}

async function makeAuthenticatedWs() {
  const ws = makeWs();
  await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "valid-token", version: "0.1.2" }));
  return ws;
}

beforeEach(() => {
  mockPatchStatus.mockClear();
  mockSetResourceMetrics.mockClear();
  mockVerifyAccessToken.mockClear();
  mockVerifyAccessToken.mockImplementation(() => Promise.resolve({ sub: "1" }));
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe("auth", () => {
  test("accepts valid token — does not close connection", async () => {
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "valid", version: "0.1.2" }));
    expect(ws.closed).toHaveLength(0);
  });

  test("rejects invalid token with close(4401)", async () => {
    mockVerifyAccessToken.mockImplementation(() => Promise.reject(new Error("bad token")));
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "bad", version: "0.1.2" }));
    expect((ws.closed as Array<[number, string]>)[0][0]).toBe(4401);
  });

  test("rejects non-auth message before auth with close(4401)", async () => {
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "status_update", taskId: "1", status: {} }));
    expect((ws.closed as Array<[number, string]>)[0][0]).toBe(4401);
  });

  test("rejects agent with version below minimum with close(4426)", async () => {
    mockConfig.minAgentVersion = "0.1.1";
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "valid", version: "0.1.0" }));
    expect((ws.closed as Array<[number, string]>)[0][0]).toBe(4426);
  });

  test("sends upgrade_required error message when version is too old", async () => {
    mockConfig.minAgentVersion = "0.1.1";
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "valid", version: "0.1.0" }));
    const messages = ws.sent.map((s: string) => JSON.parse(s));
    expect(messages.some((m: any) => m.type === "error" && m.code === "upgrade_required")).toBe(true);
  });

  test("accepts agent with version equal to minimum", async () => {
    mockConfig.minAgentVersion = "0.1.1";
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "valid", version: "0.1.1" }));
    expect(ws.closed).toHaveLength(0);
  });

  test("accepts agent with version above minimum", async () => {
    mockConfig.minAgentVersion = "0.1.1";
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "valid", version: "0.2.0" }));
    expect(ws.closed).toHaveLength(0);
  });

  test("rejects agent with no version field", async () => {
    mockConfig.minAgentVersion = "0.1.1";
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "valid" }));
    expect((ws.closed as Array<[number, string]>)[0][0]).toBe(4426);
    const sent = JSON.parse((ws.sent as string[])[0]);
    expect(sent.code).toBe("upgrade_required");
  });
});

// ─── status_update ────────────────────────────────────────────────────────────

describe("status_update", () => {
  test("calls patchStatus with taskId and status fields", async () => {
    const ws = await makeAuthenticatedWs();
    mockPatchStatus.mockClear();
    await _wsHandler.message(ws, JSON.stringify({
      type: "status_update",
      taskId: "1001",
      status: { status: "running", phase: "analyze" },
    }));
    expect(mockPatchStatus).toHaveBeenCalledWith("1001", { status: "running", phase: "analyze" });
  });

  test("uses taskId (not issueId) as the identifier", async () => {
    const ws = await makeAuthenticatedWs();
    mockPatchStatus.mockClear();
    await _wsHandler.message(ws, JSON.stringify({
      type: "status_update",
      taskId: "9999",
      status: { status: "failed" },
    }));
    const [id] = mockPatchStatus.mock.calls[0] as unknown as [string, any];
    expect(id).toBe("9999");
  });
});

// ─── ack ──────────────────────────────────────────────────────────────────────

describe("ack", () => {
  test("resolves a pending ack with response data", async () => {
    const ws = await makeAuthenticatedWs();
    let resolved: any;
    registerPendingAck("req_test_1", (d) => { resolved = d; }, () => {}, 5000);
    await _wsHandler.message(ws, JSON.stringify({
      type: "ack",
      requestId: "req_test_1",
      ok: true,
      data: { sessionId: "sess-abc" },
    }));
    expect(resolved.data.sessionId).toBe("sess-abc");
  });

  test("rejects a pending ack on error", async () => {
    const ws = await makeAuthenticatedWs();
    let rejected: any = null;
    registerPendingAck("req_test_2", () => {}, (e) => { rejected = e; }, 5000);
    await _wsHandler.message(ws, JSON.stringify({
      type: "ack",
      requestId: "req_test_2",
      ok: false,
      error: "command failed",
    }));
    expect(rejected?.message).toBe("command failed");
  });

  test("ignores ack for unknown requestId", async () => {
    const ws = await makeAuthenticatedWs();
    await _wsHandler.message(ws, JSON.stringify({
      type: "ack",
      requestId: "req_unknown",
      ok: true,
    }));
    // no throw
  });
});

// ─── request_submit_token / cleanup_submit_token ──────────────────────────────

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("request_submit_token", () => {
  test("server generates token and sends submit_token_issued back", async () => {
    const ws = await makeAuthenticatedWs();
    ws.sent.length = 0;
    await _wsHandler.message(ws, JSON.stringify({
      type: "request_submit_token",
      requestId: "req_tok_1",
      taskId: 5001,
      projectId: TEST_PROJECT_ID,
      phase: "analyze",
    }));
    const messages = ws.sent.map((s: string) => JSON.parse(s));
    const response = messages.find((m: any) => m.type === "submit_token_issued");
    expect(response).toBeDefined();
    expect(response.requestId).toBe("req_tok_1");
    expect(typeof response.token).toBe("string");
    expect(response.token.length).toBeGreaterThan(0);
  });

  test("token stored in DB is hashed — not the raw token", async () => {
    const ws = await makeAuthenticatedWs();
    ws.sent.length = 0;
    await _wsHandler.message(ws, JSON.stringify({
      type: "request_submit_token",
      requestId: "req_tok_2",
      taskId: 5002,
      projectId: TEST_PROJECT_ID,
      phase: "analyze",
    }));
    const response = ws.sent.map((s: string) => JSON.parse(s)).find((m: any) => m.type === "submit_token_issued");
    const { db } = await import("../db");
    const { submitTokens } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(submitTokens).where(eq(submitTokens.task_id, 5002));
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(response.token);
  });

  test("hash of returned token matches what is stored", async () => {
    const ws = await makeAuthenticatedWs();
    ws.sent.length = 0;
    await _wsHandler.message(ws, JSON.stringify({
      type: "request_submit_token",
      requestId: "req_tok_3",
      taskId: 5003,
      projectId: TEST_PROJECT_ID,
      phase: "execute",
    }));
    const response = ws.sent.map((s: string) => JSON.parse(s)).find((m: any) => m.type === "submit_token_issued");
    const { db } = await import("../db");
    const { submitTokens } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(submitTokens).where(eq(submitTokens.task_id, 5003));
    expect(rows[0].token_hash).toBe(await sha256(response.token));
  });

  test("replaces existing token for same task+phase", async () => {
    const ws = await makeAuthenticatedWs();
    await _wsHandler.message(ws, JSON.stringify({
      type: "request_submit_token",
      requestId: "req_tok_4a",
      taskId: 5004,
      projectId: TEST_PROJECT_ID,
      phase: "analyze",
    }));
    await _wsHandler.message(ws, JSON.stringify({
      type: "request_submit_token",
      requestId: "req_tok_4b",
      taskId: 5004,
      projectId: TEST_PROJECT_ID,
      phase: "analyze",
    }));
    const { db } = await import("../db");
    const { submitTokens } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(submitTokens).where(eq(submitTokens.task_id, 5004));
    expect(rows).toHaveLength(1);
  });

  test("each request produces a different token", async () => {
    const ws = await makeAuthenticatedWs();
    ws.sent.length = 0;
    await _wsHandler.message(ws, JSON.stringify({
      type: "request_submit_token",
      requestId: "req_tok_5a",
      taskId: 5005,
      projectId: TEST_PROJECT_ID,
      phase: "analyze",
    }));
    await _wsHandler.message(ws, JSON.stringify({
      type: "request_submit_token",
      requestId: "req_tok_5b",
      taskId: 5006,
      projectId: TEST_PROJECT_ID,
      phase: "analyze",
    }));
    const responses = ws.sent.map((s: string) => JSON.parse(s)).filter((m: any) => m.type === "submit_token_issued");
    expect(responses[0].token).not.toBe(responses[1].token);
  });
});

describe("cleanup_submit_token", () => {
  test("removes the token from submit_tokens", async () => {
    const ws = await makeAuthenticatedWs();
    await _wsHandler.message(ws, JSON.stringify({
      type: "request_submit_token",
      requestId: "req_cleanup_1",
      taskId: 5010,
      projectId: TEST_PROJECT_ID,
      phase: "execute",
    }));
    await _wsHandler.message(ws, JSON.stringify({
      type: "cleanup_submit_token",
      taskId: 5010,
      phase: "execute",
    }));
    const { db } = await import("../db");
    const { submitTokens } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(submitTokens).where(eq(submitTokens.task_id, 5010));
    expect(rows).toHaveLength(0);
  });
});

// ─── resource_update ──────────────────────────────────────────────────────────

describe("resource_update", () => {
  test("calls setResourceMetrics with container data", async () => {
    const ws = await makeAuthenticatedWs();
    mockSetResourceMetrics.mockClear();
    await _wsHandler.message(ws, JSON.stringify({
      type: "resource_update",
      containers: [{ id: "c1", name: "task-1001", cpu_pct: 5, mem_mb: 200 }],
      aggregate: { count: 1, total_cpu_pct: 5, total_mem_mb: 200 },
      host: { cpu_pct: 20, mem_used_mb: 2000, mem_total_mb: 8000, mem_pct: 25, disk_free_gb: 50, mem_source: "host" },
      completed_peaks: [],
      warnings: [],
    }));
    expect(mockSetResourceMetrics).toHaveBeenCalledTimes(1);
  });
});

// ─── close ────────────────────────────────────────────────────────────────────

describe("close", () => {
  test("rejects pending acks when agent disconnects", async () => {
    const ws = await makeAuthenticatedWs();
    let rejected: any = null;
    registerPendingAck("req_close_1", () => {}, (e) => { rejected = e; }, 5000);
    _wsHandler.close(ws);
    await new Promise((r) => setTimeout(r, 10));
    expect(rejected?.message).toBe("Agent disconnected");
  });
});

// ─── sync_keys removal ────────────────────────────────────────────────────────

describe("sync_keys removal", () => {
  test("agent auth does not send a sync_keys message", async () => {
    const ws = makeWs();
    await _wsHandler.message(ws, JSON.stringify({ type: "auth", token: "valid-token", version: "0.1.2" }));
    const outgoing = ws.sent.map((s: string) => { try { return JSON.parse(s); } catch { return null; } });
    expect(outgoing.some((m: any) => m?.type === "sync_keys")).toBe(false);
  });

  test("no sync_keys message type exists in outgoing WS traffic after status_update", async () => {
    const ws = await makeAuthenticatedWs();
    ws.sent.length = 0;
    await _wsHandler.message(ws, JSON.stringify({
      type: "status_update",
      taskId: "999",
      status: { status: "running" },
    }));
    const outgoing = ws.sent.map((s: string) => { try { return JSON.parse(s); } catch { return null; } });
    expect(outgoing.some((m: any) => m?.type === "sync_keys")).toBe(false);
  });
});
