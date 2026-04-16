import type { Command } from "commander";
import { readFile } from "fs/promises";
import { runInteractive } from "@ysa-ai/ysa/runtime";

export function registerRefineCommand(program: Command) {
  program
    .command("_refine-file <configPath>")
    .description("Internal: run interactive refine session (called from terminal launcher)")
    .action(async (configPath: string) => {
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      await runInteractive(config);
    });
}
