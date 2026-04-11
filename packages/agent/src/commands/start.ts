import type { Command } from "commander";
import { connectToDashboard, disconnect } from "../ws/client.js";
import { recoverStuckTasks } from "../lib/recover.js";
import { warmKeyCache } from "../lib/keystore.js";
import { warmConfigCache } from "../lib/config-store.js";
import { loadCredentials, saveCredentials } from "../lib/credentials.js";
import { scheduleTokenRefresh } from "../lib/token-refresh.js";
import { runLoginFlow } from "./auth.js";
import { DASHBOARD_URL } from "../lib/url.js";
import { log } from "../logger.js";
import { initContainerFiles } from "../lib/container-init.js";

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Connect agent to dashboard")
    .option("--url <url>", "Dashboard URL (default: http://localhost:3333)")
    .option("-v, --verbose", "Show verbose image build output")
    .action((opts) => startCommand(opts));
}

export async function startCommand(opts: { url?: string; verbose?: boolean } = {}): Promise<void> {
  const { verbose } = opts;
  const url = opts.url ?? DASHBOARD_URL;

  let creds = await loadCredentials(url);
  if (!creds) {
    log.info("Not authenticated. Starting login flow...");
    await runLoginFlow(url);
    creds = await loadCredentials(url);
    if (!creds) process.exit(1);
  }

  await initContainerFiles(
    (line) => log.info(line),
    verbose ? (line) => log.info(line) : undefined,
  );
  await Promise.all([warmKeyCache(), warmConfigCache()]);

  let token = creds!.accessToken;

  try {
    const meRes = await fetch(`${url}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (meRes.status === 401) {
      const refreshRes = await fetch(`${url}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: creds!.refreshToken }),
        signal: AbortSignal.timeout(5000),
      });
      if (!refreshRes.ok) {
        log.info("Session expired. Starting login flow...");
        await runLoginFlow(url);
        creds = await loadCredentials(url);
        if (!creds) process.exit(1);
        token = creds!.accessToken;
      } else {
        const newTokens = await refreshRes.json() as { accessToken: string; refreshToken: string };
        await saveCredentials(url, newTokens);
        token = newTokens.accessToken;
      }
    }
  } catch {
    // Network issue — proceed with stored token
  }

  try {
    await connectToDashboard(url, token);
  } catch (err: any) {
    log.error(`Failed to connect: ${err.message}`);
    process.exit(1);
  }

  const latestCreds = await loadCredentials(url);
  if (latestCreds) scheduleTokenRefresh(latestCreds.refreshToken, latestCreds.accessToken);

  await recoverStuckTasks();

  process.on("SIGINT", () => { disconnect(); process.exit(0); });
  process.on("SIGTERM", () => { disconnect(); process.exit(0); });

  await new Promise(() => {});
}
