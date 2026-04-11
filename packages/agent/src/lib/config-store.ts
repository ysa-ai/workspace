import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import type { AgentConfig, DevServer } from "./config";
import { log } from "../logger";

export type StoredProjectConfig = Omit<AgentConfig, "dashboardPort" | "issuesDir">;

const cache = new Map<string, StoredProjectConfig>();

function getConfigFilePath(): string {
  return join(process.env.HOME || "~", ".config", "ysa-agent", "config.json");
}

export function getCachedConfig(projectId: string): StoredProjectConfig | undefined {
  return cache.get(projectId);
}

export async function saveProjectConfig(projectId: string, cfg: StoredProjectConfig): Promise<void> {
  cache.set(projectId, cfg);
  try {
    const filePath = getConfigFilePath();
    let all: Record<string, StoredProjectConfig> = {};
    try {
      const content = await readFile(filePath, "utf-8");
      all = JSON.parse(content);
    } catch {}
    all[projectId] = cfg;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(all, null, 2), { mode: 0o600 });
  } catch (err: any) {
    log.warn(`Failed to persist config for ${projectId}: ${err.message}`);
  }
}

export async function warmConfigCache(): Promise<void> {
  try {
    const content = await readFile(getConfigFilePath(), "utf-8");
    const all = JSON.parse(content) as Record<string, StoredProjectConfig>;
    for (const [projectId, cfg] of Object.entries(all)) {
      cache.set(projectId, cfg);
    }
  } catch {
    // No config file yet
  }
}
