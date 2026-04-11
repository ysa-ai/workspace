import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { log } from "../logger";

export interface DashboardCredentials {
  accessToken: string;
  refreshToken: string;
}

const KEYCHAIN_SERVICE = "ysa-agent";

export async function saveCredentials(url: string, tokens: DashboardCredentials): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await saveToKeychain(url, tokens);
    } else {
      await saveToFile(url, tokens);
    }
  } catch (err: any) {
    log.warn(`Failed to persist credentials for ${url}: ${err.message}`);
  }
}

export async function loadCredentials(url: string): Promise<DashboardCredentials | null> {
  try {
    if (process.platform === "darwin") {
      return await loadFromKeychain(url);
    } else {
      return await loadFromFile(url);
    }
  } catch {
    return null;
  }
}

export async function clearCredentials(url: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await clearFromKeychain(url);
    } else {
      await clearFromFile(url);
    }
  } catch {
    // ignore
  }
}

// ─── macOS Keychain ──────────────────────────────────────────────────────────

async function saveToKeychain(url: string, tokens: DashboardCredentials): Promise<void> {
  const json = JSON.stringify(tokens);
  const proc = Bun.spawn(
    ["security", "add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", url, "-w", json, "-U"],
    { stdout: "pipe", stderr: "pipe" },
  );
  await proc.exited;
}

async function loadFromKeychain(url: string): Promise<DashboardCredentials | null> {
  const proc = Bun.spawn(
    ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", url, "-w"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

async function clearFromKeychain(url: string): Promise<void> {
  const proc = Bun.spawn(
    ["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", url],
    { stdout: "pipe", stderr: "pipe" },
  );
  await proc.exited;
}

// ─── Linux: permission-restricted file ──────────────────────────────────────

function getCredentialsFilePath(): string {
  return join(process.env.HOME || "~", ".config", "ysa-agent", "credentials.json");
}

async function saveToFile(url: string, tokens: DashboardCredentials): Promise<void> {
  const filePath = getCredentialsFilePath();
  let all: Record<string, DashboardCredentials> = {};
  try {
    const content = await readFile(filePath, "utf-8");
    all = JSON.parse(content);
  } catch {}
  all[url] = tokens;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(all, null, 2), { mode: 0o600 });
}

async function loadFromFile(url: string): Promise<DashboardCredentials | null> {
  try {
    const content = await readFile(getCredentialsFilePath(), "utf-8");
    const all = JSON.parse(content);
    return all[url] ?? null;
  } catch {
    return null;
  }
}

async function clearFromFile(url: string): Promise<void> {
  try {
    const filePath = getCredentialsFilePath();
    const content = await readFile(filePath, "utf-8");
    const all = JSON.parse(content);
    delete all[url];
    await writeFile(filePath, JSON.stringify(all, null, 2), { mode: 0o600 });
  } catch {}
}
