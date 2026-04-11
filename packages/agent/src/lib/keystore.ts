import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { log } from "../logger";

// ─── Named credentials ───────────────────────────────────────────────────────

export interface NamedCredential {
  name: string;
  provider: string;
  type: "oauth" | "api_key" | "access_token";
  createdAt: string;
}

const CRED_KEY_SERVICE = "ysa-agent-credential-keys";
const CRED_META_SERVICE = "ysa-agent-credential-meta";

function getCredentialMetaPath(): string {
  return join(process.env.HOME || "~", ".config", "ysa-agent", "credential-meta.json");
}

function getCredentialKeysPath(): string {
  return join(process.env.HOME || "~", ".config", "ysa-agent", "credential-keys.json");
}

async function readCredentialMeta(): Promise<NamedCredential[]> {
  if (process.platform === "darwin") {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", CRED_META_SERVICE, "-a", "__meta__", "-w"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    if (!out) return [];
    try { return JSON.parse(out); } catch { return []; }
  }
  try {
    const content = await readFile(getCredentialMetaPath(), "utf-8");
    return JSON.parse(content);
  } catch { return []; }
}

async function writeCredentialMeta(creds: NamedCredential[]): Promise<void> {
  const json = JSON.stringify(creds);
  if (process.platform === "darwin") {
    const proc = Bun.spawn(
      ["security", "add-generic-password", "-s", CRED_META_SERVICE, "-a", "__meta__", "-w", json, "-U"],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    return;
  }
  const filePath = getCredentialMetaPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, json, { mode: 0o600 });
}

async function readCredentialKey(name: string): Promise<string | null> {
  if (process.platform === "darwin") {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", CRED_KEY_SERVICE, "-a", name, "-w"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    return out || null;
  }
  try {
    const content = await readFile(getCredentialKeysPath(), "utf-8");
    const all = JSON.parse(content) as Record<string, string>;
    return all[name] ?? null;
  } catch { return null; }
}

async function writeCredentialKey(name: string, key: string): Promise<void> {
  if (process.platform === "darwin") {
    const proc = Bun.spawn(
      ["security", "add-generic-password", "-s", CRED_KEY_SERVICE, "-a", name, "-w", key, "-U"],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    return;
  }
  const filePath = getCredentialKeysPath();
  let all: Record<string, string> = {};
  try { const c = await readFile(filePath, "utf-8"); all = JSON.parse(c); } catch {}
  all[name] = key;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(all), { mode: 0o600 });
}

async function deleteCredentialKey(name: string): Promise<void> {
  if (process.platform === "darwin") {
    const proc = Bun.spawn(
      ["security", "delete-generic-password", "-s", CRED_KEY_SERVICE, "-a", name],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    return;
  }
  try {
    const filePath = getCredentialKeysPath();
    const content = await readFile(filePath, "utf-8");
    const all = JSON.parse(content) as Record<string, string>;
    delete all[name];
    await writeFile(filePath, JSON.stringify(all), { mode: 0o600 });
  } catch {}
}

export async function addCredential(name: string, provider: string, type: "oauth" | "api_key" | "access_token", key: string): Promise<void> {
  const existing = await readCredentialMeta();
  if (existing.find((c) => c.name === name)) {
    throw new Error(`Credential "${name}" already exists. Remove it first to replace.`);
  }
  await writeCredentialKey(name, key);
  await writeCredentialMeta([...existing, { name, provider, type, createdAt: new Date().toISOString() }]);
}

export async function removeCredential(name: string): Promise<void> {
  await deleteCredentialKey(name);
  const existing = await readCredentialMeta();
  await writeCredentialMeta(existing.filter((c) => c.name !== name));
}

export async function listCredentials(): Promise<NamedCredential[]> {
  return readCredentialMeta();
}

export async function getCredentialKey(name: string): Promise<string | null> {
  return readCredentialKey(name);
}

// ─── Legacy project keys (kept for warm cache, no longer synced from server) ─

export interface ProjectKeys {
  llmProviderKeys: Record<string, string>;
}

const cache = new Map<string, ProjectKeys>();

export function getCachedKeys(projectId: string): ProjectKeys | undefined {
  return cache.get(projectId);
}

export async function warmKeyCache(): Promise<void> {
  try {
    if (process.platform === "darwin") return;
    const filePath = getKeysFilePath();
    const content = await readFile(filePath, "utf-8");
    const all = JSON.parse(content) as Record<string, ProjectKeys>;
    for (const [projectId, keys] of Object.entries(all)) {
      cache.set(projectId, keys);
    }
  } catch {
    // No keys file yet — that's fine
  }
}

function getKeysFilePath(): string {
  return join(process.env.HOME || "~", ".config", "ysa-agent", "keys.json");
}
