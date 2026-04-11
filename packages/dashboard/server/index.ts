import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./trpc/router";
import { createContext } from "./trpc/init";
import { config } from "./config";
import { runMigrations } from "./db/migrate";
import { getProjectConfig } from "./lib/project-bootstrap";
import { upsertStepPrompt, readStepPrompt, patchStatus, readStatus, readStuckTasks, getTaskWorkflowState, markWorkflowStepComplete } from "./lib/status";
import { db } from "./db";
import { toolPresets, taskWorkflowStates, stepResults, stepModuleData, workflowSteps, users, organizations, orgMembers, sessions, deviceAuthCodes, submitTokens, tasks, stepPrompts, emailVerificationTokens, passwordResetTokens, emailChangeTokens, appSettings } from "./db/schema";
import { sendEmail } from "./lib/email";
import { eq, and, lt, isNull, inArray } from "drizzle-orm";
import { hashRefreshToken, verifyAccessToken } from "./lib/auth";
import { randomBytes } from "crypto";
import { createSessionTokens, rotateSession } from "./lib/auth-helpers";
import { unblockDependents } from "./lib/blockers";
import { wsHandler, disconnectAgent } from "./ws/handler";
import { sendCommand, isAgentConnectedForUser } from "./ws/dispatch";
import { migrateEncryptKeys } from "./lib/crypto-migrate";
import { join } from "path";
import { log } from "./logger";
import { rateLimit } from "./lib/rate-limit.js";
import { telemetry } from "./lib/telemetry";

await runMigrations();
await migrateEncryptKeys();
telemetry("instance.started").catch(() => {});

// Clean up orphaned detection tasks (no project assigned, older than 1h)
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const orphanIds = await db.select({ id: tasks.task_id }).from(tasks).where(and(eq(tasks.source_type, "detect"), isNull(tasks.project_id), lt(tasks.updated_at, oneHourAgo)));
if (orphanIds.length > 0) {
  const ids = orphanIds.map(r => r.id);
  await db.delete(stepPrompts).where(inArray(stepPrompts.task_id, ids));
  await db.delete(tasks).where(inArray(tasks.task_id, ids));
}

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.use("*", async (c, next) => {
  const path = c.req.path;
  const isAppRoute = path.startsWith("/app") || path.startsWith("/trpc") || path.startsWith("/auth") || path.startsWith("/api") || path.startsWith("/ws");
  if (isAppRoute && path !== "/health" && path !== "/api/admin/maintenance") {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "maintenance_mode")).limit(1);
    if (row?.value === "true") {
    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Under maintenance — ysa</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #09090b;
      color: #e4e4e7;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: #18181b;
      border: 1px solid #27272a;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 22px;
    }
    .card {
      text-align: center;
      max-width: 380px;
      width: 100%;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 12px;
      color: #a1a1aa;
      margin-bottom: 20px;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f59e0b;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    h1 {
      font-size: 22px;
      font-weight: 600;
      color: #fafafa;
      margin-bottom: 10px;
      letter-spacing: -0.3px;
    }
    p {
      font-size: 14px;
      color: #71717a;
      line-height: 1.6;
    }
    .footer {
      margin-top: 48px;
      font-size: 12px;
      color: #3f3f46;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔧</div>
    <div class="badge"><span class="dot"></span> Scheduled maintenance</div>
    <h1>We'll be right back</h1>
    <p>We're performing some maintenance to improve your experience. This won't take long.</p>
  </div>
  <div class="footer">ysa workspace</div>
</body>
</html>`, 503);
    }
  }
  await next();
});

app.post("/api/admin/maintenance", async (c) => {
  if (!config.adminSecret || c.req.header("x-admin-secret") !== config.adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const { enabled } = await c.req.json() as { enabled: boolean };
  await db.update(appSettings).set({ value: String(enabled) }).where(eq(appSettings.key, "maintenance_mode"));
  return c.json({ ok: true, maintenanceMode: enabled });
});

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  const scriptSrc = process.env.NODE_ENV === "production" ? "'self'" : "'self' 'unsafe-inline'";
  c.res.headers.set("Content-Security-Policy", `default-src 'self'; script-src ${scriptSrc}; connect-src 'self' wss: ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'`);
});

app.use("/trpc/*", cors({
  origin: config.origin || "http://localhost:3333",
  credentials: true,
}));
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: ({ req }) => createContext({ req }),
  }),
);

app.use("/auth/login", rateLimit(10));
app.use("/auth/register", rateLimit(10));
app.use("/auth/forgot-password", rateLimit(10));
app.use("/auth/resend-verification", rateLimit(5));
app.use("/auth/device/init", rateLimit(10));
app.use("/auth/device/token", rateLimit(10));
app.use("/auth/device/approve", rateLimit(10));
app.use("/auth/google", rateLimit(20));
app.use("/auth/google/callback", rateLimit(20));

// ─── Submit token validation ─────────────────────────────────────────────

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getUserIdForTask(taskId: string): Promise<number | undefined> {
  const [row] = await db.select({ created_by: tasks.created_by }).from(tasks)
    .where(eq(tasks.task_id, parseInt(taskId))).limit(1);
  return row?.created_by ?? undefined;
}

async function getUserIdFromBearer(c: any): Promise<number | undefined> {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return undefined;
  try {
    const payload = await verifyAccessToken(auth.slice(7));
    return parseInt(payload.sub);
  } catch {
    return undefined;
  }
}

async function validateSubmitToken(c: any, issueId: number): Promise<boolean> {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const hash = await sha256(token);
  const now = Date.now();
  await db.delete(submitTokens).where(lt(submitTokens.expires_at, now));
  const rows = await db.select().from(submitTokens)
    .where(and(eq(submitTokens.token_hash, hash), eq(submitTokens.task_id, issueId)))
    .limit(1);
  if (rows.length === 0) return false;
  if (rows[0].project_id === "") return true;
  const status = await readStatus(String(issueId));
  if (!status?.project_id) return false;
  return rows[0].project_id === status.project_id;
}


// ─── Container API (called by sandboxed Claude via curl) ──────────────────

app.post("/api/tasks/:id/result", async (c) => {
  const id = c.req.param("id");
  if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.text();
  let data: Record<string, any>;
  try {
    data = JSON.parse(body);
  } catch {
    data = { raw: body };
  }
  try {
    const status = await readStatus(id);
    if (status?.project_id) {
      const userId = await getUserIdForTask(id);
      if (userId && isAgentConnectedForUser(userId)) {
        const cfg = await getProjectConfig(status.project_id, userId);
        if (cfg.worktreePrefix) {
          const worktree = `${cfg.worktreePrefix}${id}`;
          const ack = await sendCommand("get_git_info", { worktree }, 10000);
          if (ack.ok && ack.data) Object.assign(data, ack.data);
        }
      }
    }
  } catch {
    // best-effort
  }
  await db.insert(stepResults)
    .values({ task_id: parseInt(id), step_id: 0, result_type: "detect", content: JSON.stringify(data) })
    .onConflictDoUpdate({
      target: [stepResults.task_id, stepResults.step_id],
      set: { content: JSON.stringify(data), updated_at: new Date().toISOString() },
    });
  return c.json({ ok: true });
});

app.get("/api/tasks/:id/result", async (c) => {
  const id = c.req.param("id");
  if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
  const row = (await db.select().from(stepResults)
    .where(and(eq(stepResults.task_id, parseInt(id)), eq(stepResults.step_id, 0))))[0];
  if (!row?.content) return c.text("", 404);
  try { return c.json(JSON.parse(row.content)); } catch { return c.text(row.content); }
});

app.get("/api/tasks/:id/prompt", async (c) => {
  const id = c.req.param("id");
  if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
  const step = c.req.query("step");
  if (!step) return c.text("", 404);
  const content = await readStepPrompt(id, step);
  if (!content) return c.text("", 404);
  return c.text(content);
});


app.post("/api/tasks/:id/steps/:slug/result", async (c) => {
  const id = c.req.param("id");
  if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
  const slug = c.req.param("slug");
  const body = await c.req.text();

  const state = await getTaskWorkflowState(id);
  const stepId = state ? (() => {
    try {
      const snapshot = JSON.parse(state.workflow_snapshot);
      return snapshot.steps?.find((s: any) => s.slug === slug)?.id ?? 0;
    } catch { return 0; }
  })() : 0;

  await db.insert(stepResults)
    .values({ task_id: parseInt(id), step_id: stepId, result_type: "step", content: body })
    .onConflictDoUpdate({
      target: [stepResults.task_id, stepResults.step_id],
      set: { content: body, updated_at: new Date().toISOString() },
    });
  return c.json({ ok: true });
});

app.post("/api/tasks/:id/steps/:slug/module/:module", async (c) => {
  const id = c.req.param("id");
  if (!await validateSubmitToken(c, parseInt(id))) return c.json({ error: "Unauthorized" }, 401);
  const slug = c.req.param("slug");
  const module = c.req.param("module");
  const body = await c.req.text();

  const state = await getTaskWorkflowState(id);
  if (!state) return c.json({ ok: true });

  try {
    const snapshot = JSON.parse(state.workflow_snapshot);
    const step = snapshot.steps?.find((s: any) => s.slug === slug);
    if (step) {
      await db.insert(stepModuleData)
        .values({ task_id: parseInt(id), step_id: step.id, module, data: body })
        .onConflictDoUpdate({
          target: [stepModuleData.task_id, stepModuleData.step_id, stepModuleData.module],
          set: { data: body, updated_at: new Date().toISOString() },
        });
    }
  } catch { /* */ }
  return c.json({ ok: true });
});

// ─── Auth ────────────────────────────────────────────────────────────────────

app.post("/auth/register", async (c) => {
  if (config.signupDisabled) {
    const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
    if (anyUser) return c.json({ error: "Sign-ups are disabled on this instance" }, 403);
  }

  let body: { email?: string; password?: string; orgName?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const { email, password, orgName } = body;
  if (!email || !password) return c.json({ error: "email and password required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "Invalid email address" }, 400);
  if (password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
  if (!/\d/.test(password)) return c.json({ error: "Password must contain at least one number" }, 400);
  if (!orgName?.trim()) return c.json({ error: "Organization name required" }, 400);

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) return c.json({ error: "An account with this email already exists. Try signing in instead." }, 409);

  const now = new Date().toISOString();
  const password_hash = await Bun.password.hash(password);
  const [user] = await db.insert(users).values({ email, password_hash, email_verified_at: now }).returning({ id: users.id });

  const [org] = await db.insert(organizations).values({ name: orgName.trim() }).returning({ id: organizations.id });
  await db.insert(orgMembers).values({ user_id: user.id, org_id: org.id, role: "owner" });

  const [membership] = await db.select({ org_id: orgMembers.org_id })
    .from(orgMembers).where(eq(orgMembers.user_id, user.id)).limit(1);

  const tokens = await createSessionTokens(user.id, membership.org_id);
  return c.json(tokens, 201);
});

app.post("/auth/login", async (c) => {
  let body: { email?: string; password?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const { email, password } = body;
  if (!email || !password) return c.json({ error: "email and password required" }, 400);

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (user?.force_password_reset) {
    const tempToken = randomBytes(32).toString("hex");
    const tokenHash = await sha256(tempToken);
    const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.user_id, user.id));
    await db.insert(passwordResetTokens).values({ user_id: user.id, token_hash: tokenHash, expires_at });
    return c.json({ forceReset: true, tempToken }, 200);
  }

  if (!user || !user.password_hash) return c.json({ error: "Invalid credentials" }, 401);
  const valid = await Bun.password.verify(password, user.password_hash);
  if (!valid) return c.json({ error: "Invalid credentials" }, 401);

  const [membership] = await db.select({ org_id: orgMembers.org_id })
    .from(orgMembers).where(eq(orgMembers.user_id, user.id)).limit(1);
  if (!membership) return c.json({ error: "No organization found" }, 500);

  const tokens = await createSessionTokens(user.id, membership.org_id);
  return c.json(tokens);
});

app.post("/auth/logout", async (c) => {
  let body: { refreshToken?: string };
  try { body = await c.req.json(); } catch { body = {}; }
  if (body.refreshToken) {
    const tokenHash = hashRefreshToken(body.refreshToken);
    const [session] = await db.select({ user_id: sessions.user_id }).from(sessions).where(eq(sessions.token_hash, tokenHash)).limit(1);
    if (session) {
      await db.delete(sessions).where(eq(sessions.user_id, session.user_id));
    } else {
      await db.delete(sessions).where(eq(sessions.token_hash, tokenHash));
    }
  }
  disconnectAgent();
  return c.json({ ok: true });
});

app.post("/auth/refresh", async (c) => {
  let body: { refreshToken?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.refreshToken) return c.json({ error: "refreshToken required" }, 400);

  const tokenHash = hashRefreshToken(body.refreshToken);
  const [session] = await db.select().from(sessions).where(eq(sessions.token_hash, tokenHash)).limit(1);
  if (!session) return c.json({ error: "Invalid or expired session" }, 401);

  if (new Date(session.expires_at) < new Date()) {
    await db.delete(sessions).where(eq(sessions.token_hash, tokenHash));
    return c.json({ error: "Session expired" }, 401);
  }

  let sessionOrgId = session.org_id;
  if (!sessionOrgId) {
    const [membership] = await db.select({ org_id: orgMembers.org_id })
      .from(orgMembers).where(eq(orgMembers.user_id, session.user_id)).limit(1);
    if (!membership) return c.json({ error: "No organization found" }, 500);
    sessionOrgId = membership.org_id;
  }

  const result = await rotateSession(tokenHash, session.user_id, sessionOrgId);
  if (!result) return c.json({ error: "Session already rotated" }, 401);

  return c.json(result);
});

app.get("/auth/me", async (c) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
  try {
    const payload = await verifyAccessToken(auth.slice(7));
    const [user] = await db.select({ id: users.id, email: users.email })
      .from(users).where(eq(users.id, parseInt(payload.sub))).limit(1);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const [org] = payload.orgId != null
      ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, payload.orgId)).limit(1)
      : [];
    return c.json({ id: user.id, email: user.email, orgId: payload.orgId, orgName: org?.name ?? "" });
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});

app.get("/auth/orgs", async (c) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
  try {
    const payload = await verifyAccessToken(auth.slice(7));
    const userId = parseInt(payload.sub);
    const rows = await db.select({
      id: organizations.id,
      name: organizations.name,
      role: orgMembers.role,
    })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.org_id, organizations.id))
      .where(eq(orgMembers.user_id, userId));
    return c.json(rows);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});

app.post("/auth/orgs", async (c) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
  let body: { name?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.name?.trim()) return c.json({ error: "Organization name required" }, 400);
  try {
    const payload = await verifyAccessToken(auth.slice(7));
    const userId = parseInt(payload.sub);
    const [org] = await db.insert(organizations).values({ name: body.name.trim() }).returning({ id: organizations.id, name: organizations.name });
    await db.insert(orgMembers).values({ user_id: userId, org_id: org.id, role: "owner" });
    return c.json(org, 201);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});

app.post("/auth/switch-org", async (c) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
  let body: { orgId?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.orgId) return c.json({ error: "orgId required" }, 400);
  try {
    const payload = await verifyAccessToken(auth.slice(7));
    const userId = parseInt(payload.sub);
    const [membership] = await db.select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.user_id, userId), eq(orgMembers.org_id, body.orgId)))
      .limit(1);
    if (!membership) return c.json({ error: "Not a member of this organization" }, 403);
    const tokens = await createSessionTokens(userId, body.orgId);
    return c.json(tokens);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});

// ─── Device auth flow (agent login) ─────────────────────────────────────────

app.post("/auth/device/init", async (c) => {
  const device_code = randomBytes(32).toString("hex");
  const user_code = randomBytes(16).toString("hex");
  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await db.insert(deviceAuthCodes).values({ device_code, user_code, expires_at });

  const origin = config.origin || new URL(c.req.url).origin;
  const verification_uri = `${origin}/app/auth/device?code=${user_code}`;

  return c.json({ device_code, verification_uri, expires_in: 900, interval: 3 });
});

app.get("/auth/device/token", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.json({ error: "code required" }, 400);

  const [row] = await db.select().from(deviceAuthCodes)
    .where(eq(deviceAuthCodes.device_code, code)).limit(1);

  if (!row || row.used_at || new Date(row.expires_at.replace(" ", "T") + "Z") < new Date()) {
    return c.json({ error: "Not found or expired" }, 404);
  }

  if (!row.user_id) {
    return c.json({ status: "pending" }, 202);
  }

  await db.update(deviceAuthCodes)
    .set({ used_at: new Date().toISOString() })
    .where(eq(deviceAuthCodes.id, row.id));

  const tokens = await createSessionTokens(row.user_id, null);
  return c.json(tokens);
});

app.post("/auth/device/approve", async (c) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);

  let payload: { sub: string; orgId: number };
  try {
    payload = await verifyAccessToken(auth.slice(7)) as any;
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { user_code?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.user_code) return c.json({ error: "user_code required" }, 400);

  const [row] = await db.select().from(deviceAuthCodes)
    .where(eq(deviceAuthCodes.user_code, body.user_code)).limit(1);

  if (!row || row.used_at || new Date(row.expires_at.replace(" ", "T") + "Z") < new Date()) {
    return c.json({ error: "Code not found or expired" }, 404);
  }

  await db.update(deviceAuthCodes)
    .set({ user_id: parseInt(payload.sub) })
    .where(eq(deviceAuthCodes.id, row.id));

  return c.json({ ok: true });
});

// ─── Email verification ───────────────────────────────────────────────────────

app.get("/auth/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: "token required" }, 400);

  const tokenHash = await sha256(token);
  const [row] = await db.select().from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token_hash, tokenHash)).limit(1);

  if (!row || row.used_at || new Date(row.expires_at.replace(" ", "T") + "Z") < new Date()) {
    return c.json({ error: "Invalid or expired verification link" }, 404);
  }

  await db.update(users)
    .set({ email_verified_at: new Date().toISOString() })
    .where(eq(users.id, row.user_id));
  await db.update(emailVerificationTokens)
    .set({ used_at: new Date().toISOString() })
    .where(eq(emailVerificationTokens.id, row.id));

  const [membership] = await db.select({ org_id: orgMembers.org_id })
    .from(orgMembers).where(eq(orgMembers.user_id, row.user_id)).limit(1);
  if (!membership) return c.json({ error: "No organization found" }, 500);

  const tokens = await createSessionTokens(row.user_id, membership.org_id);
  return c.json(tokens);
});

app.post("/auth/resend-verification", async (c) => {
  return c.json({ ok: true });
});

// ─── Password reset ───────────────────────────────────────────────────────────

app.post("/auth/forgot-password", async (c) => {
  if (!process.env.RESEND_API_KEY) return c.json({ error: "Email is not configured on this instance" }, 503);

  let body: { email?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.email) return c.json({ ok: true });

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (!user) return c.json({ ok: true }); // don't leak existence

  const token = randomBytes(32).toString("hex");
  const tokenHash = await sha256(token);
  const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.user_id, user.id));
  await db.insert(passwordResetTokens).values({ user_id: user.id, token_hash: tokenHash, expires_at });

  const origin = config.origin || new URL(c.req.url).origin;
  const resetUrl = `${origin}/app/reset-password?token=${token}`;
  sendEmail(body.email, "Reset your ysa password", `<p>Click the link below to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`).catch(() => {});

  return c.json({ ok: true });
});

app.post("/auth/reset-password", async (c) => {
  let body: { token?: string; password?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.token || !body.password) return c.json({ error: "token and password required" }, 400);
  if (body.password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
  if (!/\d/.test(body.password)) return c.json({ error: "Password must contain at least one number" }, 400);

  const tokenHash = await sha256(body.token);
  const [row] = await db.select().from(passwordResetTokens)
    .where(eq(passwordResetTokens.token_hash, tokenHash)).limit(1);

  if (!row || row.used_at || new Date(row.expires_at.replace(" ", "T") + "Z") < new Date()) {
    return c.json({ error: "Invalid or expired reset link" }, 400);
  }

  const password_hash = await Bun.password.hash(body.password);
  await db.update(users).set({ password_hash }).where(eq(users.id, row.user_id));
  await db.delete(sessions).where(eq(sessions.user_id, row.user_id));
  await db.update(passwordResetTokens)
    .set({ used_at: new Date().toISOString() })
    .where(eq(passwordResetTokens.id, row.id));

  return c.json({ ok: true });
});

app.post("/auth/set-forced-password", async (c) => {
  let body: { token?: string; password?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.token || !body.password) return c.json({ error: "token and password required" }, 400);
  if (body.password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
  if (!/\d/.test(body.password)) return c.json({ error: "Password must contain at least one number" }, 400);

  const tokenHash = await sha256(body.token);
  const [row] = await db.select().from(passwordResetTokens)
    .where(eq(passwordResetTokens.token_hash, tokenHash)).limit(1);

  if (!row || row.used_at || new Date(row.expires_at.replace(" ", "T") + "Z") < new Date()) {
    return c.json({ error: "Invalid or expired token" }, 400);
  }

  const password_hash = await Bun.password.hash(body.password);
  await db.update(users)
    .set({ password_hash, force_password_reset: false })
    .where(eq(users.id, row.user_id));
  await db.update(passwordResetTokens)
    .set({ used_at: new Date().toISOString() })
    .where(eq(passwordResetTokens.id, row.id));

  const [membership] = await db.select({ org_id: orgMembers.org_id })
    .from(orgMembers).where(eq(orgMembers.user_id, row.user_id)).limit(1);
  if (!membership) return c.json({ error: "No organization found" }, 500);

  const tokens = await createSessionTokens(row.user_id, membership.org_id);
  return c.json(tokens);
});

// ─── Email change verification ────────────────────────────────────────────────

app.get("/auth/verify-email-change", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: "token required" }, 400);

  const tokenHash = await sha256(token);
  const [row] = await db.select().from(emailChangeTokens)
    .where(eq(emailChangeTokens.token_hash, tokenHash)).limit(1);

  if (!row || row.used_at || new Date(row.expires_at.replace(" ", "T") + "Z") < new Date()) {
    return c.json({ error: "Invalid or expired link" }, 400);
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, row.new_email)).limit(1);
  if (existing.length > 0) return c.json({ error: "Email already in use" }, 409);

  await db.update(users).set({ email: row.new_email }).where(eq(users.id, row.user_id));
  await db.update(emailChangeTokens)
    .set({ used_at: new Date().toISOString() })
    .where(eq(emailChangeTokens.id, row.id));

  return c.json({ ok: true });
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────

app.get("/auth/google", async (c) => {
  if (!config.googleClientId) return c.json({ error: "Google OAuth not configured" }, 503);

  const state = randomBytes(16).toString("hex");
  const origin = config.origin || new URL(c.req.url).origin;
  const redirectUri = `${origin}/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "email profile",
    state,
    prompt: "select_account",
  });

  const cookieDomainAttr = config.cookieDomain ? `; Domain=${config.cookieDomain}` : "";
  c.header("Set-Cookie", `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/${cookieDomainAttr}`);
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/google/callback", async (c) => {
  const origin = config.origin || new URL(c.req.url).origin;
  const failRedirect = `${origin}/app/signin?error=oauth_failed`;

  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieHeader = c.req.header("cookie") ?? "";
  const oauthStateCookie = cookieHeader.split(";").map((s) => s.trim()).find((s) => s.startsWith("oauth_state="))?.slice("oauth_state=".length) ?? "";

  if (!code || !state || state !== oauthStateCookie) return c.redirect(failRedirect);

  const cookieDomainAttr = config.cookieDomain ? `; Domain=${config.cookieDomain}` : "";
  c.header("Set-Cookie", `oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/${cookieDomainAttr}`);

  const redirectUri = `${origin}/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return c.redirect(failRedirect);

  const tokenData = await tokenRes.json() as { access_token?: string };
  if (!tokenData.access_token) return c.redirect(failRedirect);

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) return c.redirect(failRedirect);

  const { email, name, id: googleId } = await userRes.json() as { email: string; name: string; id: string };
  if (!email) return c.redirect(failRedirect);

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  let isNewUser = false;
  if (!user) {
    if (config.signupDisabled) {
      const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
      if (anyUser) return c.redirect(`${failRedirect}?error=signups_disabled`);
    }
    isNewUser = true;
    const orgName = name?.trim() || email.split("@")[0];
    const now = new Date().toISOString();
    [user] = await db.insert(users).values({
      email,
      google_id: googleId,
      email_verified_at: now,
      tos_accepted_at: now,
    }).returning();
    const [org] = await db.insert(organizations).values({ name: orgName }).returning({ id: organizations.id });
    await db.insert(orgMembers).values({ user_id: user.id, org_id: org.id, role: "owner" });
  } else if (!user.google_id) {
    await db.update(users).set({ google_id: googleId }).where(eq(users.id, user.id));
  }

  const [membership] = await db.select({ org_id: orgMembers.org_id })
    .from(orgMembers).where(eq(orgMembers.user_id, user.id)).limit(1);
  if (!membership) return c.redirect(failRedirect);

  const tokens = await createSessionTokens(user.id, membership.org_id);
  const newParam = isNewUser ? "&new=1" : "";
  return c.redirect(`${origin}/app/auth/google/callback?access=${tokens.accessToken}&refresh=${tokens.refreshToken}${newParam}`);
});

// Return JSON 404 for unmatched /api/* routes (prevents SPA fallback returning HTML)
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

app.get("/", (c) => c.redirect("/app"));

if (process.env.NODE_ENV === "production") {
  const distDir = join(import.meta.dir, "..", "dist");
  app.get("/app/assets/*", async (c) => {
    const assetName = c.req.path.slice("/app/assets/".length);
    const file = Bun.file(join(distDir, "assets", assetName));
    if (await file.exists()) return new Response(file);
    return c.notFound();
  });
  app.get("/app/*", async (c) => {
    return new Response(Bun.file(join(distDir, "index.html")));
  });
} else {
  app.get("/app/*", async (c) => {
    const url = `http://localhost:5173${c.req.path}${c.req.url.includes("?") ? "?" + new URL(c.req.url).searchParams.toString() : ""}`;
    const res = await fetch(url).catch(() => null);
    if (!res) return c.text("Vite dev server not running on :5173", 503);
    return new Response(res.body, { status: res.status, headers: res.headers });
  });
}

export default {
  port: config.port,
  fetch(req: Request, server: any) {
    const url = new URL(req.url);
    if (
      url.pathname === "/ws/agent" &&
      req.headers.get("upgrade") === "websocket"
    ) {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req, server);
  },
  websocket: { ...wsHandler, idleTimeout: 60 },
};

log.success(`Dashboard running at http://localhost:${config.port}`);
