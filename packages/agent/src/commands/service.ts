import type { Command } from "commander";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { log } from "../logger.js";

const SERVICE_NAME = "run.ysa.agent";
const LOG_FILE = join(process.env.HOME || "~", ".config", "ysa-agent", "agent.log");

export function registerServiceCommands(program: Command): void {
  const svc = program
    .command("service")
    .description("Manage the ysa-agent background service");

  svc.command("install").description("Install and start the background service").action(installCommand);
  svc.command("uninstall").description("Stop and remove the background service").action(uninstallCommand);
  svc.command("status").description("Show service status").action(statusCommand);
  svc.command("logs").description("Show service logs").action(logsCommand);
}

// ─── macOS launchd ───────────────────────────────────────────────────────────

function launchAgentsDir(): string {
  return join(process.env.HOME || "~", "Library", "LaunchAgents");
}

function plistPath(): string {
  return join(launchAgentsDir(), `${SERVICE_NAME}.plist`);
}

function agentInvocation(): string[] {
  const which = Bun.spawnSync(["which", "ysa-agent"], { stdout: "pipe" });
  const globalBin = new TextDecoder().decode(which.stdout).trim();
  if (globalBin) return [globalBin, "start"];

  // Running locally via bun src/index.ts — use bun + absolute script path
  const scriptPath = new URL(import.meta.url).pathname;
  const indexPath = scriptPath.replace(/\/commands\/service\.(ts|js)$/, "/index.ts");
  return [process.execPath, "run", indexPath, "start"];
}

function plistContent(args: string[], logFile: string): string {
  const programArgs = args.map((a) => `    <string>${a}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${process.env.HOME}</string>
    <key>PATH</key>
    <string>${process.env.PATH}</string>${process.env.YSA_URL ? `
    <key>YSA_URL</key>
    <string>${process.env.YSA_URL}</string>` : ""}
  </dict>
</dict>
</plist>
`;
}

// ─── Linux systemd ───────────────────────────────────────────────────────────

function systemdDir(): string {
  return join(process.env.HOME || "~", ".config", "systemd", "user");
}

function unitPath(): string {
  return join(systemdDir(), `${SERVICE_NAME}.service`);
}

function unitContent(args: string[], logFile: string): string {
  return `[Unit]
Description=ysa-agent
After=network.target

[Service]
ExecStart=${args.join(" ")}
Restart=always
RestartSec=5
StandardOutput=append:${logFile}
StandardError=append:${logFile}
Environment=HOME=${process.env.HOME}
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function installCommand(): Promise<void> {
  await mkdir(join(process.env.HOME || "~", ".config", "ysa-agent"), { recursive: true });

  if (process.platform === "darwin") {
    await mkdir(launchAgentsDir(), { recursive: true });
    await writeFile(plistPath(), plistContent(agentInvocation(), LOG_FILE));

    const load = Bun.spawnSync(["launchctl", "load", "-w", plistPath()]);
    if (load.exitCode !== 0) {
      log.error("Failed to load service");
      process.exit(1);
    }
    log.success(`Service installed — runs on login (logs: ${LOG_FILE})`);
  } else if (process.platform === "linux") {
    await mkdir(systemdDir(), { recursive: true });
    await writeFile(unitPath(), unitContent(agentInvocation(), LOG_FILE));

    Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
    const enable = Bun.spawnSync(["systemctl", "--user", "enable", "--now", `${SERVICE_NAME}.service`]);
    if (enable.exitCode !== 0) {
      log.error("Failed to enable service");
      process.exit(1);
    }
    log.success(`Service installed — runs on login (logs: ${LOG_FILE})`);
  } else {
    log.error("Service management is only supported on macOS and Linux");
    process.exit(1);
  }
}

async function uninstallCommand(): Promise<void> {
  if (process.platform === "darwin") {
    if (existsSync(plistPath())) {
      Bun.spawnSync(["launchctl", "unload", "-w", plistPath()]);
      await unlink(plistPath());
    }
    log.success("Service removed");
  } else if (process.platform === "linux") {
    if (existsSync(unitPath())) {
      Bun.spawnSync(["systemctl", "--user", "disable", "--now", `${SERVICE_NAME}.service`]);
      await unlink(unitPath());
      Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
    }
    log.success("Service removed");
  } else {
    log.error("Service management is only supported on macOS and Linux");
    process.exit(1);
  }
}

async function statusCommand(): Promise<void> {
  if (process.platform === "darwin") {
    const proc = Bun.spawnSync(["launchctl", "list", SERVICE_NAME], { stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode === 0) {
      log.success("Service is running");
    } else {
      log.info("Service is not running");
    }
  } else if (process.platform === "linux") {
    const proc = Bun.spawnSync(["systemctl", "--user", "is-active", `${SERVICE_NAME}.service`], { stdout: "pipe" });
    const state = new TextDecoder().decode(proc.stdout).trim();
    if (state === "active") {
      log.success("Service is running");
    } else {
      log.info(`Service is ${state || "not installed"}`);
    }
  } else {
    log.error("Service management is only supported on macOS and Linux");
  }
}

async function logsCommand(): Promise<void> {
  try {
    const content = await readFile(LOG_FILE, "utf-8");
    const lines = content.split("\n").slice(-50).join("\n");
    process.stdout.write(lines + "\n");
  } catch {
    log.info("No logs yet");
  }
}
