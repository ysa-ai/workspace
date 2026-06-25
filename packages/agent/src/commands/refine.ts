import type { Command } from "commander";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { runInteractive, setContainerDir } from "@ysa-ai/ysa/runtime";
import { assetPaths } from "../container-assets";
import { CACHE_DIR } from "../lib/container-init.js";

// Mirror initContainerFiles: when running from source (assetPaths is the empty
// stub) the container files live next to the @ysa-ai/ysa runtime, so use those
// directly — matching the execute path. Only the compiled binary, which bundles
// the files and unpacks them to CACHE_DIR, should read from the cache. Hardcoding
// CACHE_DIR made refine run a stale cached sandbox-run.sh while execute used the
// current source, so they mounted the session volume at different paths.
function resolveContainerDir(): string {
  if (Object.keys(assetPaths).length === 0) {
    const runtimePath = Bun.resolveSync("@ysa-ai/ysa/runtime", import.meta.dir);
    const sourceDir = resolve(dirname(runtimePath), "..", "container");
    if (existsSync(resolve(sourceDir, "sandbox-run.sh"))) return sourceDir;
  }
  return CACHE_DIR;
}

export function registerRefineCommand(program: Command) {
  program
    .command("_refine-file <configPath>")
    .description("Internal: run interactive refine session (called from terminal launcher)")
    .action(async (configPath: string) => {
      setContainerDir(resolveContainerDir());
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      await runInteractive(config);
    });
}
