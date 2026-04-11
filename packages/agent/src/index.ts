#!/usr/bin/env bun
import { Command } from "commander";
import { registerStartCommand } from "./commands/start.js";
import { registerInitCommand } from "./commands/init.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerServiceCommands } from "./commands/service.js";
import { registerCredentialCommands } from "./commands/credential.js";

const program = new Command();

program
  .name("ysa-agent")
  .description("ysa-agent — connects to a dashboard and runs issues in sandboxed containers")
  .version("0.1.2");

registerStartCommand(program);
registerInitCommand(program);
registerAuthCommands(program);
registerServiceCommands(program);
registerCredentialCommands(program);

program.parse();
