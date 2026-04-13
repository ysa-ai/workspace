import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./trpc/router";
import { createContext } from "./trpc/init";
import { config } from "./config";
import { runMigrations } from "./db/migrate";
import { db } from "./db";
import { tasks, stepPrompts, appSettings } from "./db/schema";
import { eq, and, lt, isNull, inArray } from "drizzle-orm";
import { wsHandler } from "./ws/handler";
import { migrateEncryptKeys } from "./lib/crypto-migrate";
import { join } from "path";
import { log } from "./logger";
import { rateLimit } from "./lib/rate-limit.js";
import { telemetry } from "./lib/telemetry";
import { registerAuthRoutes } from "./routes/auth";
import { registerContainerApiRoutes } from "./routes/container-api";

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

app.post("/api/admin/maintenance", async (c) => {
  if (!config.adminSecret || c.req.header("x-admin-secret") !== config.adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const { enabled } = await c.req.json() as { enabled: boolean };
  await db.update(appSettings).set({ value: String(enabled) }).where(eq(appSettings.key, "maintenance_mode"));
  return c.json({ ok: true, maintenanceMode: enabled });
});

registerContainerApiRoutes(app);
registerAuthRoutes(app);

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
