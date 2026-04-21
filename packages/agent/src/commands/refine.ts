import type { Command } from "commander";
import { readFile } from "fs/promises";
import { runInteractive, setContainerDir } from "@ysa-ai/ysa/runtime";
import { CACHE_DIR } from "../lib/container-init.js";

export function registerRefineCommand(program: Command) {
  program
    .command("_refine-file <configPath>")
    .description("Internal: run interactive refine session (called from terminal launcher)")
    .action(async (configPath: string) => {
      setContainerDir(CACHE_DIR);
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      await runInteractive(config);
    });
}
