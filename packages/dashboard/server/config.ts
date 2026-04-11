import { join, resolve } from "path";
import { writeFileSync, appendFileSync } from "fs";
import { randomBytes } from "crypto";

// Monorepo root is 3 levels up from packages/dashboard/server/
const monorepoRoot = resolve(import.meta.dir, "..", "..", "..");
const rootEnv = join(monorepoRoot, ".env");
const envFile = Bun.file(rootEnv);
if (await envFile.exists()) {
  const text = await envFile.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const isProd = process.env.NODE_ENV === "production";

// MASTER_KEY: used for encrypting sensitive values (API keys, tokens) in the DB.
// Auto-generated and persisted to .env on first run (local dev only).
// Must be set explicitly in production — server refuses to start otherwise.
let masterKey = process.env.MASTER_KEY || "";
if (!masterKey) {
  if (isProd) {
    console.error("[crypto] MASTER_KEY is not set. Generate one with: openssl rand -hex 32");
    process.exit(1);
  }
  masterKey = randomBytes(32).toString("hex");
  process.env.MASTER_KEY = masterKey;
  try {
    appendFileSync(rootEnv, `MASTER_KEY=${masterKey}\n`);
  } catch {
    try { writeFileSync(rootEnv, `MASTER_KEY=${masterKey}\n`); } catch {}
  }
  console.log("[crypto] Generated MASTER_KEY and saved to .env");
}

let authSecret = process.env.AUTH_SECRET || "";
if (!authSecret) {
  if (isProd) {
    console.error("[auth] AUTH_SECRET is not set. Generate one with: openssl rand -hex 32");
    process.exit(1);
  }
  authSecret = randomBytes(32).toString("hex");
  process.env.AUTH_SECRET = authSecret;
  try {
    appendFileSync(rootEnv, `AUTH_SECRET=${authSecret}\n`);
  } catch {
    try { writeFileSync(rootEnv, `AUTH_SECRET=${authSecret}\n`); } catch {}
  }
  console.log("[auth] Generated AUTH_SECRET and saved to .env");
}

export const config = {
  databaseUrl: process.env.DATABASE_URL || "postgresql://localhost:5432/ysa",
  port: parseInt(process.env.DASHBOARD_PORT || "3333"),
  origin: process.env.ORIGIN || "",
  appHostname: process.env.APP_HOSTNAME || "localhost:3333",
  masterKey,
  authSecret,
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  adminSecret: process.env.ADMIN_SECRET || "",
  cookieDomain: process.env.COOKIE_DOMAIN || "",
  minAgentVersion: process.env.MIN_AGENT_VERSION || "0.1.1",
  signupDisabled: process.env.SIGNUP_DISABLED === "true",
};
