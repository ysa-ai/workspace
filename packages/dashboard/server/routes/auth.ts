import type { Hono } from "hono";
import { db } from "../db";
import { users, organizations, orgMembers, sessions, deviceAuthCodes, emailVerificationTokens, passwordResetTokens, emailChangeTokens } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { hashRefreshToken, verifyAccessToken } from "../lib/auth";
import { randomBytes } from "crypto";
import { createSessionTokens, rotateSession, sha256 } from "../lib/auth-helpers";
import { sendEmail } from "../lib/email";
import { disconnectAgent } from "../ws/handler";
import { config } from "../config";

export function registerAuthRoutes(app: Hono): void {
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

  // ─── Device auth flow (agent login) ───────────────────────────────────────

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

  // ─── Email verification ────────────────────────────────────────────────────

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

  // ─── Password reset ────────────────────────────────────────────────────────

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

  // ─── Email change verification ─────────────────────────────────────────────

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

  // ─── Google OAuth ──────────────────────────────────────────────────────────

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
}
