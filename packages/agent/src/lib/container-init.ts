import { existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { setContainerDir, buildBaseImages } from "@ysa-ai/ysa/runtime";
import { assetPaths } from "../container-assets";
import pkg from "../../package.json";

export const AGENT_VERSION: string = pkg.version;

const CACHE_DIR = resolve(process.env.HOME ?? "~", ".cache", "ysa-agent", "container");
const CA_DIR = resolve(process.env.HOME ?? "~", ".cache", "ysa-agent", "proxy-ca");
const VERSION_FILE = resolve(process.env.HOME ?? "~", ".cache", "ysa-agent", "version");

async function copyContainerFiles(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const [name, path] of Object.entries(assetPaths)) {
    await Bun.write(resolve(CACHE_DIR, name), Bun.file(path));
  }
  await Bun.spawn(["chmod", "+x",
    resolve(CACHE_DIR, "sandbox-run.sh"),
    resolve(CACHE_DIR, "generate-ca.sh"),
    resolve(CACHE_DIR, "git-push-guard.sh"),
    resolve(CACHE_DIR, "git-safe-wrapper.sh"),
    resolve(CACHE_DIR, "container-sandbox-guard.sh"),
  ]).exited;
}

async function imageExists(name: string): Promise<boolean> {
  const proc = Bun.spawn(["podman", "image", "exists", name]);
  await proc.exited;
  return proc.exitCode === 0;
}

export async function cleanupProjectArtifacts(): Promise<void> {
  const listProc = Bun.spawn(
    ["podman", "images", "--format", "{{.Repository}}:{{.Tag}}", "--filter", "reference=sandbox-proj-*"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const stdout = await new Response(listProc.stdout).text();
  await listProc.exited;
  for (const img of stdout.trim().split("\n").filter(Boolean)) {
    await Bun.spawn(["podman", "rmi", "-f", img], { stdout: "ignore", stderr: "ignore" }).exited;
  }
  const volProc = Bun.spawn(
    ["podman", "volume", "ls", "--format", "{{.Name}}", "--filter", "name=mise-"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const volOut = await new Response(volProc.stdout).text();
  await volProc.exited;
  for (const vol of volOut.trim().split("\n").filter(Boolean)) {
    await Bun.spawn(["podman", "volume", "rm", vol], { stdout: "ignore", stderr: "ignore" }).exited;
  }
}

async function isPodmanAvailable(): Promise<boolean> {
  const proc = Bun.spawn(["podman", "info"], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
  return proc.exitCode === 0;
}

export async function initContainerFiles(onLog?: (line: string) => void, onVerbose?: (line: string) => void): Promise<void> {
  if (Object.keys(assetPaths).length === 0) {
    const runtimePath = Bun.resolveSync("@ysa-ai/ysa/runtime", import.meta.dir);
    const containerDir = resolve(dirname(runtimePath), "..", "container");
    if (existsSync(resolve(containerDir, "sandbox-run.sh"))) {
      setContainerDir(containerDir);
    }
    return;
  }

  const cachedVersion = existsSync(VERSION_FILE)
    ? (await Bun.file(VERSION_FILE).text()).trim()
    : null;

  const isFirstInstall = cachedVersion === null;
  const isUpgrade = cachedVersion !== null && cachedVersion !== AGENT_VERSION;
  const filesMissing = !existsSync(resolve(CACHE_DIR, "sandbox-run.sh"));

  if (isFirstInstall || isUpgrade || filesMissing) {
    await copyContainerFiles();
  }

  setContainerDir(CACHE_DIR);

  if (!await isPodmanAvailable()) {
    onLog?.("Podman is not available — skipping image check. Start Podman to run sandboxed tasks.");
    return;
  }

  const baseImages = ["sandbox-claude", "sandbox-mistral", "sandbox-proxy"];
  const anyMissing = (await Promise.all(baseImages.map(imageExists))).some((e) => !e);

  if (isUpgrade) {
    onLog?.(`Agent upgraded ${cachedVersion} → ${AGENT_VERSION}. Rebuilding sandbox images...`);
    onLog?.("Note: project sandbox images will be rebuilt automatically on next task run.");
    await cleanupProjectArtifacts();
    const result = await buildBaseImages(CA_DIR, onVerbose);
    if (!result.ok) throw new Error(`Image build failed: ${result.error}`);
    await Bun.write(VERSION_FILE, AGENT_VERSION);
  } else if (isFirstInstall || anyMissing) {
    onLog?.("Building sandbox images (this may take a few minutes)...");
    const result = await buildBaseImages(CA_DIR, onVerbose);
    if (!result.ok) throw new Error(`Image build failed: ${result.error}`);
    await Bun.write(VERSION_FILE, AGENT_VERSION);
  }
}
