import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test";

// ── Mocks before any import of tested modules ─────────────────────────────────

mock.module("../db", () => ({ db: (globalThis as any).__testDb }));

const mockSendCommand = mock((_cmd: string, _payload?: any, _timeoutMs?: number) =>
  Promise.resolve({ data: { credentials: [] } } as any)
);
const mockIsAgentConnected = mock(() => true);

mock.module("../ws/dispatch", () => ({
  sendCommand: mockSendCommand,
  isAgentConnected: mockIsAgentConnected,
  isAgentConnectedForUser: mockIsAgentConnected,
}));

mock.module("../lib/project-bootstrap", () => ({
  getProjectConfig: mock(() => Promise.resolve({})),
}));

// ── Now safe to import ────────────────────────────────────────────────────────

import { appRouter } from "./router";
import { db } from "../db";
import {
  userProjectCredentialPreferences,
  userProjectSettings,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import {
  seedBaseFixtures,
  truncateTaskTables,
  TEST_USER_ID,
  TEST_ORG_ID,
  TEST_PROJECT_ID,
} from "../lib/test-helpers";

function caller(userId = TEST_USER_ID, orgId = TEST_ORG_ID) {
  return appRouter.createCaller({ userId, orgId });
}

beforeAll(async () => { await seedBaseFixtures(); });

beforeEach(async () => {
  await truncateTaskTables();
  await db.delete(userProjectCredentialPreferences);
  mockSendCommand.mockClear();
  mockIsAgentConnected.mockClear();
  mockIsAgentConnected.mockReturnValue(true);
  mockSendCommand.mockImplementation(() => Promise.resolve({ data: { credentials: [] } }));
});

// ─── listCredentials ──────────────────────────────────────────────────────────

describe("projects.listCredentials", () => {
  test("returns empty array when agent connected but has no credentials", async () => {
    mockSendCommand.mockResolvedValueOnce({ data: { credentials: [] } });
    const result = await caller().projects.listCredentials();
    expect(result.credentials).toEqual([]);
  });

  test("returns credentials from agent ack data", async () => {
    const mockCreds = [
      { name: "my-key", provider: "claude", type: "api_key", createdAt: "2024-01-01T00:00:00.000Z" },
    ];
    mockSendCommand.mockResolvedValueOnce({ data: { credentials: mockCreds } });
    const result = await caller().projects.listCredentials();
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0].name).toBe("my-key");
  });

  test("returns empty array when agent is not connected", async () => {
    mockIsAgentConnected.mockReturnValue(false);
    const result = await caller().projects.listCredentials();
    expect(result.credentials).toEqual([]);
  });

  test("returns empty array when sendCommand rejects", async () => {
    mockSendCommand.mockRejectedValueOnce(new Error("timeout"));
    const result = await caller().projects.listCredentials();
    expect(result.credentials).toEqual([]);
  });
});

// ─── upsertCredentialPreference ───────────────────────────────────────────────

describe("projects.upsertCredentialPreference", () => {
  test("inserts a new credential preference", async () => {
    await caller().projects.upsertCredentialPreference({
      projectId: TEST_PROJECT_ID,
      defaultCredentialName: "my-key",
    });
    const rows = await db.select()
      .from(userProjectCredentialPreferences)
      .where(and(
        eq(userProjectCredentialPreferences.user_id, TEST_USER_ID),
        eq(userProjectCredentialPreferences.project_id, TEST_PROJECT_ID),
      ));
    expect(rows).toHaveLength(1);
    expect(rows[0].default_credential_name).toBe("my-key");
  });

  test("second upsert replaces the first", async () => {
    await caller().projects.upsertCredentialPreference({
      projectId: TEST_PROJECT_ID,
      defaultCredentialName: "first-key",
    });
    await caller().projects.upsertCredentialPreference({
      projectId: TEST_PROJECT_ID,
      defaultCredentialName: "second-key",
    });
    const rows = await db.select()
      .from(userProjectCredentialPreferences)
      .where(and(
        eq(userProjectCredentialPreferences.user_id, TEST_USER_ID),
        eq(userProjectCredentialPreferences.project_id, TEST_PROJECT_ID),
      ));
    expect(rows).toHaveLength(1);
    expect(rows[0].default_credential_name).toBe("second-key");
  });

  test("accepts null to clear the credential preference", async () => {
    await caller().projects.upsertCredentialPreference({
      projectId: TEST_PROJECT_ID,
      defaultCredentialName: "my-key",
    });
    await caller().projects.upsertCredentialPreference({
      projectId: TEST_PROJECT_ID,
      defaultCredentialName: null,
    });
    const rows = await db.select()
      .from(userProjectCredentialPreferences)
      .where(and(
        eq(userProjectCredentialPreferences.user_id, TEST_USER_ID),
        eq(userProjectCredentialPreferences.project_id, TEST_PROJECT_ID),
      ));
    expect(rows[0].default_credential_name).toBeNull();
  });
});

// ─── getUserSettings ──────────────────────────────────────────────────────────

describe("projects.getUserSettings", () => {
  test("returns nulls when no settings exist", async () => {
    const result = await caller().projects.getUserSettings({ projectId: TEST_PROJECT_ID });
    expect(result.ai_configs).toBeNull();
    expect(result.container_memory).toBeNull();
    expect(result.container_cpus).toBeNull();
    expect(result.container_pids_limit).toBeNull();
    expect(result.container_timeout).toBeNull();
  });

  test("returns ai_configs after updateAiConfigs", async () => {
    const configs = JSON.stringify([{ provider: "claude", model: "claude-sonnet-4-6", max_turns: 60, allowed_tools: "", credential_name: null, is_default: true }]);
    await caller().projects.updateAiConfigs({ projectId: TEST_PROJECT_ID, aiConfigs: configs });
    const result = await caller().projects.getUserSettings({ projectId: TEST_PROJECT_ID });
    expect(result.ai_configs).toBe(configs);
  });

  test("returns container fields after updateUserSettings", async () => {
    await caller().projects.updateUserSettings({
      projectId: TEST_PROJECT_ID,
      container_memory: "8g",
      container_cpus: 4,
      container_pids_limit: 1024,
      container_timeout: 7200,
    });
    const result = await caller().projects.getUserSettings({ projectId: TEST_PROJECT_ID });
    expect(result.container_memory).toBe("8g");
    expect(result.container_cpus).toBe(4);
    expect(result.container_pids_limit).toBe(1024);
    expect(result.container_timeout).toBe(7200);
  });
});

// ─── updateAiConfigs ──────────────────────────────────────────────────────────

describe("projects.updateAiConfigs", () => {
  test("stores ai_configs JSON in credential preferences", async () => {
    const configs = JSON.stringify([{ provider: "mistral", model: "devstral-2", max_turns: 30, allowed_tools: "", credential_name: "my-key", is_default: true }]);
    await caller().projects.updateAiConfigs({ projectId: TEST_PROJECT_ID, aiConfigs: configs });
    const rows = await db.select().from(userProjectCredentialPreferences)
      .where(and(eq(userProjectCredentialPreferences.user_id, TEST_USER_ID), eq(userProjectCredentialPreferences.project_id, TEST_PROJECT_ID)));
    expect(rows[0].ai_configs).toBe(configs);
  });

  test("second call replaces first", async () => {
    const first = JSON.stringify([{ provider: "claude", model: "claude-sonnet-4-6", max_turns: 60, allowed_tools: "", credential_name: null, is_default: true }]);
    const second = JSON.stringify([{ provider: "mistral", model: "devstral-2", max_turns: 30, allowed_tools: "", credential_name: null, is_default: true }]);
    await caller().projects.updateAiConfigs({ projectId: TEST_PROJECT_ID, aiConfigs: first });
    await caller().projects.updateAiConfigs({ projectId: TEST_PROJECT_ID, aiConfigs: second });
    const rows = await db.select().from(userProjectCredentialPreferences)
      .where(and(eq(userProjectCredentialPreferences.user_id, TEST_USER_ID), eq(userProjectCredentialPreferences.project_id, TEST_PROJECT_ID)));
    expect(rows[0].ai_configs).toBe(second);
  });
});

// ─── schema integrity ─────────────────────────────────────────────────────────

describe("schema integrity", () => {
  test("user_project_settings has no llm_api_key column", async () => {
    // Insert a row and verify no llm_api_key field in the ORM schema object
    const schemaKeys = Object.keys(userProjectSettings);
    expect(schemaKeys).not.toContain("llm_api_key");
  });

  test("user_project_credential_preferences table is accessible", async () => {
    const rows = await db.select().from(userProjectCredentialPreferences);
    expect(Array.isArray(rows)).toBe(true);
  });
});
