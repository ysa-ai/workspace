import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test";

// ── Mocks (must come before any import of tested modules) ─────────────────────

mock.module("../db", () => ({ db: (globalThis as any).__testDb }));
mock.module("../db/migrate", () => ({ runMigrations: () => Promise.resolve() }));
mock.module("../lib/crypto-migrate", () => ({ migrateEncryptKeys: () => Promise.resolve() }));
mock.module("../lib/telemetry", () => ({ telemetry: () => Promise.resolve() }));
mock.module("../ws/handler", () => ({ wsHandler: {}, disconnectAgent: () => {} }));
mock.module("../ws/dispatch", () => ({ sendCommand: mock(() => Promise.resolve({})), isAgentConnected: mock(() => false), isAgentConnectedForUser: mock(() => false) }));
mock.module("../lib/email", () => ({ sendEmail: () => Promise.resolve() }));

// ── Imports ───────────────────────────────────────────────────────────────────

import { appRouter } from "./router";
import { app } from "../index";
import { db } from "../db";
import { users, orgMembers, sessions, passwordResetTokens } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { seedBaseFixtures, TEST_USER_ID, TEST_ORG_ID } from "../lib/test-helpers";

const OWNER_ID = TEST_USER_ID;
const MEMBER_ID = 9901;
const MEMBER_EMAIL = "member-auth-test@example.com";

function ownerCaller() {
  return appRouter.createCaller({ userId: OWNER_ID, orgId: TEST_ORG_ID });
}

function memberCaller() {
  return appRouter.createCaller({ userId: MEMBER_ID, orgId: TEST_ORG_ID });
}

function post(path: string, body: unknown) {
  return app.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeAll(async () => {
  await seedBaseFixtures();

  await db.insert(users)
    .values({ id: MEMBER_ID, email: MEMBER_EMAIL, password_hash: await Bun.password.hash("Password1") })
    .onConflictDoNothing();

  await db.insert(orgMembers)
    .values({ user_id: MEMBER_ID, org_id: TEST_ORG_ID, role: "member" })
    .onConflictDoNothing();
});

beforeEach(async () => {
  await db.update(users).set({ force_password_reset: false }).where(eq(users.id, MEMBER_ID));
  await db.delete(sessions).where(eq(sessions.user_id, MEMBER_ID));
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.user_id, MEMBER_ID));
});

// ─── auth.forcePasswordReset ──────────────────────────────────────────────────

describe("auth.forcePasswordReset", () => {
  test("owner sets force_password_reset flag on member", async () => {
    await ownerCaller().auth.forcePasswordReset({ userId: MEMBER_ID });

    const [user] = await db.select({ force_password_reset: users.force_password_reset })
      .from(users).where(eq(users.id, MEMBER_ID)).limit(1);
    expect(user.force_password_reset).toBe(true);
  });

  test("invalidates all sessions for the target user", async () => {
    await db.insert(sessions).values({
      user_id: MEMBER_ID,
      org_id: TEST_ORG_ID,
      token_hash: "fakehash_auth_test",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    await ownerCaller().auth.forcePasswordReset({ userId: MEMBER_ID });

    const remaining = await db.select().from(sessions).where(eq(sessions.user_id, MEMBER_ID));
    expect(remaining).toHaveLength(0);
  });

  test("member cannot force reset another user", async () => {
    await expect(memberCaller().auth.forcePasswordReset({ userId: OWNER_ID }))
      .rejects.toThrow("Only the owner");
  });

  test("owner cannot force reset themselves", async () => {
    await expect(ownerCaller().auth.forcePasswordReset({ userId: OWNER_ID }))
      .rejects.toThrow("Cannot force reset your own password");
  });

  test("owner cannot force reset another owner", async () => {
    const OTHER_OWNER_ID = 9902;
    await db.insert(users)
      .values({ id: OTHER_OWNER_ID, email: "owner2-auth-test@example.com", password_hash: "x" })
      .onConflictDoNothing();
    await db.insert(orgMembers)
      .values({ user_id: OTHER_OWNER_ID, org_id: TEST_ORG_ID, role: "owner" })
      .onConflictDoNothing();

    await expect(ownerCaller().auth.forcePasswordReset({ userId: OTHER_OWNER_ID }))
      .rejects.toThrow("Cannot reset the owner's password");

    await db.delete(orgMembers).where(and(eq(orgMembers.user_id, OTHER_OWNER_ID), eq(orgMembers.org_id, TEST_ORG_ID)));
    await db.delete(users).where(eq(users.id, OTHER_OWNER_ID));
  });
});

// ─── POST /auth/login — force reset flag ──────────────────────────────────────

describe("POST /auth/login — force_password_reset", () => {
  test("returns forceReset: true with tempToken regardless of password", async () => {
    await db.update(users).set({ force_password_reset: true }).where(eq(users.id, MEMBER_ID));

    const res = await post("/auth/login", { email: MEMBER_EMAIL, password: "wrongpassword" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.forceReset).toBe(true);
    expect(typeof data.tempToken).toBe("string");
    expect(data.tempToken.length).toBeGreaterThan(0);
  });

  test("normal login works when flag is not set", async () => {
    const res = await post("/auth/login", { email: MEMBER_EMAIL, password: "Password1" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.accessToken).toBeTruthy();
    expect(data.forceReset).toBeUndefined();
  });
});

// ─── POST /auth/set-forced-password ───────────────────────────────────────────

describe("POST /auth/set-forced-password", () => {
  async function getTempToken(): Promise<string> {
    await db.update(users).set({ force_password_reset: true }).where(eq(users.id, MEMBER_ID));
    const res = await post("/auth/login", { email: MEMBER_EMAIL, password: "anything" });
    const data = await res.json();
    return data.tempToken;
  }

  test("sets new password, clears flag, returns session tokens", async () => {
    const tempToken = await getTempToken();

    const res = await post("/auth/set-forced-password", { token: tempToken, password: "NewPassword1" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();

    const [user] = await db.select({ force_password_reset: users.force_password_reset })
      .from(users).where(eq(users.id, MEMBER_ID)).limit(1);
    expect(user.force_password_reset).toBe(false);
  });

  test("rejects token used twice", async () => {
    const tempToken = await getTempToken();

    await post("/auth/set-forced-password", { token: tempToken, password: "NewPassword1" });
    const res2 = await post("/auth/set-forced-password", { token: tempToken, password: "AnotherPass1" });

    expect(res2.status).toBe(400);
  });

  test("rejects invalid token", async () => {
    const res = await post("/auth/set-forced-password", { token: "notavalidtoken", password: "NewPassword1" });
    expect(res.status).toBe(400);
  });

  test("rejects password shorter than 8 chars", async () => {
    const tempToken = await getTempToken();
    const res = await post("/auth/set-forced-password", { token: tempToken, password: "Ab1" });
    expect(res.status).toBe(400);
  });

  test("rejects password with no number", async () => {
    const tempToken = await getTempToken();
    const res = await post("/auth/set-forced-password", { token: tempToken, password: "NoNumbers!" });
    expect(res.status).toBe(400);
  });
});
