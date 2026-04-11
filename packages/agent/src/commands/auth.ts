import type { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import { loadCredentials, saveCredentials, clearCredentials } from "../lib/credentials.js";
import { DASHBOARD_URL } from "../lib/url.js";
import { log } from "../logger.js";

const SERVICE_NAME = "run.ysa.agent";

function restartServiceIfInstalled(): void {
  if (process.platform === "darwin") {
    const plist = join(process.env.HOME || "~", "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
    if (!existsSync(plist)) return;
    Bun.spawn(["launchctl", "kickstart", "-k", `gui/${process.getuid?.() ?? 501}/${SERVICE_NAME}`], { stdout: "ignore", stderr: "ignore" });
  } else if (process.platform === "linux") {
    Bun.spawn(["systemctl", "--user", "restart", `${SERVICE_NAME}.service`], { stdout: "ignore", stderr: "ignore" });
  }
}

export function registerAuthCommands(program: Command): void {
  program
    .command("login")
    .description("Authenticate with your ysa workspace")
    .action(() => loginCommand(DASHBOARD_URL));

  program
    .command("logout")
    .description("Remove stored credentials")
    .action(() => logoutCommand(DASHBOARD_URL));

  program
    .command("whoami")
    .description("Show authentication status")
    .action(() => statusCommand(DASHBOARD_URL));
}

export async function runLoginFlow(url: string): Promise<void> {
  return loginCommand(url);
}

export async function loginCommand(url: string): Promise<void> {
  let initRes: Response;
  try {
    initRes = await fetch(`${url}/auth/device/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    log.error(`Cannot reach ${url}`);
    process.exit(1);
  }

  if (!initRes.ok) {
    log.error(`Failed to start login: ${initRes.status}`);
    process.exit(1);
  }

  const { device_code, verification_uri, interval } = await initRes.json() as {
    device_code: string;
    verification_uri: string;
    interval: number;
  };

  log.info(`Opening browser to authorize: ${verification_uri}`);

  const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([openCmd, verification_uri], { stdout: "ignore", stderr: "ignore" });

  const pollInterval = (interval || 3) * 1000;
  const timeout = Date.now() + 15 * 60 * 1000;

  while (Date.now() < timeout) {
    await Bun.sleep(pollInterval);
    let pollRes: Response;
    try {
      pollRes = await fetch(`${url}/auth/device/token?code=${device_code}`);
    } catch {
      continue;
    }

    if (pollRes.status === 200) {
      const tokens = await pollRes.json() as { accessToken: string; refreshToken: string };
      await saveCredentials(url, tokens);
      log.success("Authenticated");
      restartServiceIfInstalled();
      return;
    }
    if (pollRes.status === 404) {
      log.error("Authorization code expired");
      process.exit(1);
    }
    // 202 = still pending, continue polling
  }

  log.error("Authorization timed out");
  process.exit(1);
}

async function logoutCommand(url: string): Promise<void> {
  const creds = await loadCredentials(url);
  if (creds) {
    try {
      await fetch(`${url}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: creds.refreshToken }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
  }
  await clearCredentials(url);
  log.success("Logged out");
}

async function statusCommand(url: string): Promise<void> {
  const creds = await loadCredentials(url);
  if (!creds) {
    log.info("Not authenticated");
    return;
  }
  log.success(`Authenticated to ${url}`);
}
