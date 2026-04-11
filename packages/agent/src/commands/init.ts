import type { Command } from "commander";
import { setContainerDir, buildBaseImages } from "@ysa-ai/ysa/runtime";
import { cleanupProjectArtifacts, AGENT_VERSION } from "../lib/container-init.js";
import { assetPaths } from "../container-assets.js";
import { resolve } from "path";
import { mkdirSync } from "fs";

const CACHE_DIR = resolve(process.env.HOME ?? "~", ".cache", "ysa-agent", "container");
const CA_DIR = resolve(process.env.HOME ?? "~", ".cache", "ysa-agent", "proxy-ca");
const VERSION_FILE = resolve(process.env.HOME ?? "~", ".cache", "ysa-agent", "version");

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize or repair the agent (rebuilds all sandbox images)")
    .action(initCommand);
}

export async function initCommand(): Promise<void> {
  if (Object.keys(assetPaths).length === 0) {
    console.log("No container assets bundled — skipping (dev mode).");
    return;
  }

  console.log("Initializing ysa-agent...");

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

  setContainerDir(CACHE_DIR);

  console.log("Cleaning up project images and runtime volumes...");
  await cleanupProjectArtifacts();

  console.log("Building sandbox images (this may take a few minutes)...");
  const result = await buildBaseImages(CA_DIR, (line) => process.stdout.write(`  ${line}\n`));

  if (!result.ok) {
    console.error(`Image build failed: ${result.error}`);
    process.exit(1);
  }

  await Bun.write(VERSION_FILE, AGENT_VERSION);
  console.log("Done. Run `ysa-agent start` to connect.");
}
