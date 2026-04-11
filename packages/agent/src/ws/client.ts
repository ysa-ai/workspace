import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import type { AgentConfig } from "../lib/config";
import { setSendFn, sendToDashboard, resolveRequest, rejectAllPendingRequests } from "./send.js";
import { parseBuildLine } from "./parse-build-line.js";
import type { DashboardCommand, AckMessage, ResourceUpdate } from "@ysa-ai/shared";
import { clearCredentials } from "../lib/credentials.js";
import { AGENT_VERSION } from "../lib/container-init.js";
import * as executor from "../lib/executor";
import { startResourceMonitor } from "../lib/monitor";
import { listCredentials } from "../lib/keystore";
import { saveProjectConfig, getCachedConfig } from "../lib/config-store";
import { stat, readdir } from "fs/promises";
import { log } from "../logger";

async function pickDirectoryNative(): Promise<string | null> {
  if (process.platform === "darwin") {
    const proc = Bun.spawn(
      ["osascript", "-e", 'POSIX path of (choose folder with prompt "Select directory:")'],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    return out || null;
  }
  for (const [bin, ...args] of [
    ["zenity", "--file-selection", "--directory", "--title=Select directory"],
    ["kdialog", "--getexistingdirectory", "/"],
  ] as [string, ...string[]][]) {
    try {
      const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      const out = (await new Response(proc.stdout).text()).trim();
      if (out) return out;
    } catch {}
  }
  return null;
}

async function pickFileNative(prompt: string): Promise<string | null> {
  if (process.platform === "darwin") {
    const proc = Bun.spawn(
      ["osascript", "-e", `POSIX path of (choose file with prompt "${prompt}")`],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    return out || null;
  }
  for (const [bin, ...args] of [
    ["zenity", "--file-selection", `--title=${prompt}`],
    ["kdialog", "--getopenfilename", "/"],
  ] as [string, ...string[]][]) {
    try {
      const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      const out = (await new Response(proc.stdout).text()).trim();
      if (out) return out;
    } catch {}
  }
  return null;
}

async function pickFileOrFolderNative(): Promise<string | null> {
  if (process.platform === "darwin") {
    const proc = Bun.spawn(
      ["osascript", "-e", 'POSIX path of (choose file name with prompt "Select file or folder:")'],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    return out || null;
  }
  for (const [bin, ...args] of [
    ["zenity", "--file-selection", "--title=Select file or folder"],
    ["kdialog", "--getopenfilename", "/"],
  ] as [string, ...string[]][]) {
    try {
      const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      const out = (await new Response(proc.stdout).text()).trim();
      if (out) return out;
    } catch {}
  }
  return null;
}

let ws: WebSocket | null = null;
let reconnectTimer: Timer | null = null;
let heartbeatTimer: Timer | null = null;
let stopMonitor: (() => void) | null = null;
let connected = false;
let storedToken: string | undefined;
let dashboardPort = 3333;

export function isConnected(): boolean {
  return connected;
}

export function connectToDashboard(
  dashboardUrl: string,
  token?: string,
): Promise<void> {
  storedToken = token;
  try {
    const parsed = new URL(dashboardUrl);
    if (parsed.port) dashboardPort = parseInt(parsed.port);
  } catch { /* */ }
  return new Promise((resolve, reject) => {
    const wsUrl = dashboardUrl.replace(/^http/, "ws") + "/ws/agent";

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (storedToken) {
        ws!.send(JSON.stringify({ type: "auth", token: storedToken, version: AGENT_VERSION }));
      }

      connected = true;
      setSendFn((msg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); });
      log.success("Connected to dashboard via WebSocket");

      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ type: "heartbeat", timestamp: Date.now() }),
          );
        }
      }, 30000);

      stopMonitor = startResourceMonitor((msg: ResourceUpdate) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      });

      resolve();
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(
          typeof event.data === "string"
            ? event.data
            : event.data.toString(),
        );

        if (msg.type === "error" && msg.code === "upgrade_required") {
          log.error(msg.message);
          process.exit(1);
        }
        if (msg.type === "submit_token_issued") {
          resolveRequest(msg.requestId, msg.token, msg.error);
          return;
        }
        if (msg.type === "agent_response") {
          resolveRequest(msg.requestId, msg.data, msg.ok ? undefined : (msg.error || "Request failed"));
          return;
        }
        if (msg.type !== "command") return;
        await handleCommand(msg as DashboardCommand, dashboardUrl);
      } catch (err: any) {
        log.error("Error handling WS message:", err);
      }
    };

    ws.onclose = (event) => {
      const wasConnected = connected;
      connected = false;
      setSendFn(null);
      rejectAllPendingRequests("Agent WebSocket disconnected");
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      if (event.code === 4401) {
        log.warn("Disconnected by server (logged out) — clearing credentials");
        clearCredentials(dashboardUrl).catch(() => {});
        return;
      }

      if (event.code === 4426) {
        return;
      }

      if (wasConnected) {
        log.warn("WebSocket disconnected, reconnecting...");
        scheduleReconnect(dashboardUrl);
      } else {
        reject(new Error("Failed to connect to dashboard WebSocket"));
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  });
}

function scheduleReconnect(dashboardUrl: string) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connectToDashboard(dashboardUrl, storedToken);
    } catch {
      scheduleReconnect(dashboardUrl);
    }
  }, 3000);
}

function sendAck(
  requestId: string,
  ok: boolean,
  data?: unknown,
  error?: string,
) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const ack: AckMessage = { type: "ack", requestId, ok, error, data };
  ws.send(JSON.stringify(ack));
}

function configFromPayload(payload: Record<string, unknown>): AgentConfig {
  const projectId = payload.projectId as string | undefined | null;
  const cached = projectId ? getCachedConfig(projectId) : undefined;
  const src = cached ?? {} as Record<string, unknown>;
  // detect tasks send inline projectRoot/worktreePrefix since they have no cached project
  const projectRoot = (src.projectRoot as string) || (payload.projectRoot as string) || "";
  const worktreePrefix = (src.worktreePrefix as string) || (payload.worktreePrefix as string) || "";
  return {
    projectRoot,
    worktreePrefix,
    branchPrefix: (src.branchPrefix as string) || "fix/",
    installCmd: (src.installCmd as string) || "",
    buildCmd: (src.buildCmd as string) || "",
    preDevCmd: (src.preDevCmd as string) || undefined,
    envFiles: (src.envFiles as string[]) || [],
    worktreeFiles: (src.worktreeFiles as string[]) || [],
    projectId: (src.projectId as string) || projectId || undefined,
    languages: (src.languages as string[]) || [],
    devServers: (src.devServers as any[]) || [],
    mcpConfig: (src.mcpConfig as string) ?? null,
    dashboardPort,
    issuesDir: join(projectRoot || process.env.HOME || "~", ".ysa", "issues"),
    issueUrlTemplate: (src.issueUrlTemplate as string) || "",
    qaEnabled: (src.qaEnabled as boolean) ?? false,
    testCmd: (src.testCmd as string) || "",
    networkPolicy: ((payload.networkPolicy ?? src.networkPolicy) as AgentConfig["networkPolicy"]) || "none",
    llmProvider: (src.llmProvider as string) || "claude",
    llmModel: (src.llmModel as string) || undefined,
    llmMaxTurns: (payload.llmMaxTurns as number) || (src.llmMaxTurns as number) || 60,
    defaultCredentialName: (src.defaultCredentialName as string) || undefined,
    issueSource: (src.issueSource as "gitlab" | "github") || "gitlab",
    sourceType: (payload.sourceType as "provider" | "prompt" | "detect") || "provider",
    defaultBranch: (src.defaultBranch as string) || undefined,
    codeRepoUrl: (src.codeRepoUrl as string) || undefined,
    gitlabProjectId: (src.gitlabProjectId as number) || undefined,
    orgId: (src.orgId as string) || undefined,
    npmrcPath: (src.npmrcPath as string) || undefined,
    depsCacheFiles: (src.depsCacheFiles as string[]) || [],
    branchOverrides: (payload.branchOverrides as Record<string, string>) || undefined,
  };
}

async function handleCommand(
  msg: DashboardCommand,
  dashboardUrl: string,
) {
  const { requestId, command, payload } = msg;
  log.info(`← ${command}`, payload);

  try {
    switch (command) {
      case "pickDirectory": {
        const path = await pickDirectoryNative();
        sendAck(requestId, true, { path });
        break;
      }
      case "pickFile": {
        const path = await pickFileNative((payload.prompt as string) ?? "Select file");
        sendAck(requestId, true, { path });
        break;
      }
      case "pickFileOrFolder": {
        const path = await pickFileOrFolderNative();
        sendAck(requestId, true, { path });
        break;
      }
      case "validatePath": {
        const p = payload.path as string;
        try {
          const s = await stat(p);
          if (!s.isDirectory()) {
            sendAck(requestId, false, undefined, `Path is not a directory: ${p}`);
          } else {
            sendAck(requestId, true);
          }
        } catch {
          sendAck(requestId, false, undefined, `Path does not exist: ${p}`);
        }
        break;
      }
      case "validateProjectRoot": {
        const p = payload.path as string;
        try {
          const s = await stat(p);
          if (!s.isDirectory()) {
            sendAck(requestId, false, undefined, `Not a directory: ${p}`);
            break;
          }
        } catch {
          sendAck(requestId, false, undefined, `Path does not exist: ${p}`);
          break;
        }
        const git = Bun.spawnSync(["git", "-C", p, "rev-parse", "--git-dir"]);
        if (git.exitCode !== 0) {
          sendAck(requestId, false, undefined, `Not a git repository: ${p}`);
        } else {
          sendAck(requestId, true);
        }
        break;
      }
      case "log_subscribe": {
        const issueId = payload.taskId as string;
        const phase = payload.phase as string;
        const offset = (payload.offset as number) || 0;
        const networkOffset = (payload.networkOffset as number) || 0;
        const projectRoot = payload.projectRoot as string;
        const networkPolicy = payload.networkPolicy as string | undefined;
        const mcpConfigPath = payload.mcpConfigPath as string | null | undefined;
        const orgId = payload.orgId as string | undefined;
        const projectId = payload.projectId as string | undefined;
        const sandboxId = [orgId, projectId, issueId, phase].filter(Boolean).join("-");
        const logPath = join(projectRoot, ".ysa", "logs", `${sandboxId}.log`);

        let raw = "";
        let nextOffset = offset;
        try {
          const buf = await Bun.file(logPath).arrayBuffer();
          const bytes = new Uint8Array(buf);
          raw = new TextDecoder().decode(bytes.subarray(offset));
          nextOffset = bytes.length;
        } catch {}

        if (mcpConfigPath) {
          try {
            const cfgText = await Bun.file(mcpConfigPath as string).text();
            const mcpCfg = JSON.parse(cfgText);
            const secrets: string[] = [];
            for (const server of Object.values(mcpCfg.mcpServers ?? {})) {
              const s = server as any;
              if (s.env && typeof s.env === "object") {
                for (const val of Object.values(s.env)) {
                  if (typeof val === "string" && val.length >= 8 && !val.includes("://") && !val.startsWith("/")) secrets.push(val);
                }
              }
            }
            for (const secret of secrets) raw = raw.replaceAll(secret, "******");
          } catch {}
        }

        let networkEntries: unknown[] = [];
        let nextNetworkOffset = networkOffset;
        if (networkPolicy === "strict") {
          try {
            const HIDDEN_HOSTS = ["api.anthropic.com", "sentry.io", "statsig.anthropic.com", "datadoghq.com", "host.containers.internal", "registry.npmjs.org"];
            const logFile = Bun.file(`${process.env.HOME}/.ysa/proxy-logs/${sandboxId}.log`);
            const proxyRaw = await logFile.exists() ? await logFile.text() : "";
            const allLines = proxyRaw.trim() ? proxyRaw.trim().split("\n") : [];
            const newLines = allLines.slice(networkOffset);
            nextNetworkOffset = allLines.length;
            networkEntries = newLines
              .filter(line => /\[(ALLOW|BLOCK)\]/.test(line))
              .filter(line => !HIDDEN_HOSTS.some(h => line.includes(h)))
              .map(line => {
                const isBlock = line.includes("[BLOCK]");
                const actionMatch = line.match(/\[(ALLOW|BLOCK)\]/);
                const cleaned = actionMatch ? line.slice(line.indexOf(actionMatch[0])) : line;
                const tsMatch = line.match(/^\[([^\]]+)\]/);
                return { type: "network", icon: isBlock ? "block" : "allow", text: cleaned, ts: tsMatch ? new Date(tsMatch[1]).getTime() : undefined };
              });
          } catch {}
        }

        sendAck(requestId, true, { raw, nextOffset, networkEntries, nextNetworkOffset });
        break;
      }
      case "get_git_info": {
        const worktree = payload.worktree as string;
        const result: Record<string, unknown> = {};
        const decode = (b: Uint8Array) => new TextDecoder().decode(b).trim();
        const git = (args: string[]) => Bun.spawnSync(["git", "-C", worktree, ...args], { stdout: "pipe", stderr: "pipe" });

        const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
        if (branch.exitCode === 0) { const b = decode(branch.stdout); if (b && b !== "HEAD") result.branch = b; }

        const commit = git(["rev-parse", "HEAD"]);
        if (commit.exitCode === 0) result.commit_hash = decode(commit.stdout);

        const msg = git(["log", "-1", "--pretty=%s"]);
        if (msg.exitCode === 0) result.commit_message = decode(msg.stdout);

        let files: string[] = [];
        for (const base of ["main", "master", "develop"]) {
          const mb = git(["merge-base", "HEAD", `origin/${base}`]);
          if (mb.exitCode === 0) {
            const diff = git(["diff", "--name-only", decode(mb.stdout), "HEAD"]);
            if (diff.exitCode === 0) files = decode(diff.stdout).split("\n").filter(Boolean);
            break;
          }
        }
        if (!files.length) {
          const show = git(["show", "--name-only", "--format=", "HEAD"]);
          if (show.exitCode === 0) files = decode(show.stdout).split("\n").filter(Boolean);
        }
        if (files.length) result.files_changed = files;

        for (const base of ["main", "master", "develop"]) {
          const mb = git(["merge-base", "HEAD", `origin/${base}`]);
          if (mb.exitCode === 0) {
            const diff = git(["diff", decode(mb.stdout), "HEAD"]);
            if (diff.exitCode === 0) { result.diff = decode(diff.stdout); break; }
          }
        }
        if (!result.diff) {
          const diff = git(["show", "HEAD"]);
          if (diff.exitCode === 0) result.diff = decode(diff.stdout);
        }

        sendAck(requestId, true, result);
        break;
      }
      case "checkIssue": {
        const worktree = payload.worktree as string;
        const projectRoot = payload.projectRoot as string;
        const branch = payload.branch as string;
        const worktreeExists = await stat(worktree).then((s) => s.isDirectory()).catch(() => false);
        let branchExists = false;
        if (projectRoot && branch) {
          const proc = Bun.spawn(
            ["git", "-C", projectRoot, "rev-parse", "--verify", branch],
            { stdout: "ignore", stderr: "ignore" },
          );
          branchExists = (await proc.exited) === 0;
        }
        sendAck(requestId, true, { worktreeExists, branchExists });
        break;
      }
      case "cloneSandbox": {
        const dir = payload.directory as string;
        const repo = payload.repoUrl as string;
        const files = await readdir(dir).catch(() => null);
        if (files && files.length > 0) {
          sendAck(requestId, false, undefined, "This folder is not empty, please choose an empty one");
          break;
        }
        const proc = Bun.spawn(["git", "clone", repo, dir], { stdout: "inherit", stderr: "inherit" });
        const code = await proc.exited;
        if (code !== 0) {
          sendAck(requestId, false, undefined, `git clone exited with code ${code}`);
        } else {
          sendAck(requestId, true);
        }
        break;
      }
      case "listCredentials": {
        const credentials = await listCredentials();
        let hasClaudeOAuth = false;
        if (process.platform === "darwin") {
          const { username } = (await import("os")).userInfo();
          const probe = Bun.spawn(["security", "find-generic-password", "-s", "Claude Code-credentials", "-a", username, "-w"], { stdout: "pipe", stderr: "pipe" });
          await probe.exited;
          hasClaudeOAuth = !!(await new Response(probe.stdout).text()).trim();
          if (!hasClaudeOAuth) {
            const probe2 = Bun.spawn(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"], { stdout: "pipe", stderr: "pipe" });
            await probe2.exited;
            hasClaudeOAuth = !!(await new Response(probe2.stdout).text()).trim();
          }
        } else {
          try { hasClaudeOAuth = !!(await import("fs/promises").then(m => m.readFile(join(process.env.HOME ?? "~", ".claude", ".credentials.json"), "utf-8"))); } catch {}
        }
        const all = hasClaudeOAuth
          ? [{ name: "OAuth", provider: "claude", type: "oauth" as const, createdAt: "" }, ...credentials]
          : credentials;
        sendAck(requestId, true, { credentials: all });
        break;
      }
      case "getCredential": {
        const { getCredentialKey } = await import("../lib/keystore.js");
        const key = await getCredentialKey(payload.name as string);
        sendAck(requestId, true, { key });
        break;
      }
      case "sync_config": {
        const configs = payload.configs as Record<string, Record<string, unknown>>;
        for (const [projectId, cfg] of Object.entries(configs)) {
          await saveProjectConfig(projectId, cfg as any);
        }
        sendAck(requestId, true);
        break;
      }
      case "buildProject": {
        const {
          projectId, projectRoot, ysaToml, apkPackages, projectImage, containerImage,
          packageManager, tools, miseVolume, env, runtimeEnv, copyDirs,
          hadApkImage, oldImage,
        } = payload as Record<string, any>;

        if (projectRoot && ysaToml !== undefined) {
          await mkdir(join(projectRoot, ".ysa"), { recursive: true });
          await writeFile(join(projectRoot, ".ysa.toml"), ysaToml, "utf-8");
        }

        if (hadApkImage && oldImage) {
          await Bun.spawn(["podman", "rmi", "-f", oldImage], { stdout: "ignore", stderr: "ignore" }).exited;
        }
        await Bun.spawn(["podman", "volume", "rm", miseVolume], { stdout: "ignore", stderr: "ignore" }).exited;

        const { buildProjectImage, installRuntimes } = await import("@ysa-ai/ysa/runtime");

        let lastProgress = 0;
        const onLog = (line: string) => {
          log.info(line);
          const parsed = parseBuildLine(line);
          if (parsed) {
            if (parsed.progress !== undefined) lastProgress = parsed.progress;
            sendToDashboard({ type: "build_progress", projectId, step: parsed.step, progress: parsed.progress ?? lastProgress });
          }
        };

        log.info(`Building project runtime (volume: ${miseVolume})...`);
        if ((apkPackages as string[]).length > 0) {
          const result = await buildProjectImage(apkPackages, projectImage, containerImage, packageManager, onLog);
          if (!result.ok) { sendAck(requestId, false, undefined, result.error); break; }
        }
        if ((tools as any[]).length > 0) {
          const result = await installRuntimes(tools, miseVolume, projectImage, env, runtimeEnv, copyDirs, onLog);
          if (!result.ok) { sendAck(requestId, false, undefined, result.error); break; }
        }
        log.info(`Project runtime build complete.`);

        sendAck(requestId, true);
        break;
      }
      default: {
        const config = configFromPayload(payload);
        return handleConfigCommand(requestId, command, payload, config, dashboardUrl);
      }
    }
  } catch (err: any) {
    log.error(`${command} failed:`, err.message);
    sendAck(requestId, false, undefined, err.message);
  }
}

async function handleConfigCommand(
  requestId: string,
  command: string,
  payload: Record<string, unknown>,
  config: ReturnType<typeof configFromPayload>,
  dashboardUrl: string,
) {
  try {
    switch (command) {
      case "init": {
        sendAck(requestId, true);
        executor.runInit(
          payload.issues as number[],
          dashboardUrl,
          config,
        );
        break;
      }
      case "advance": {
        executor.spawnPhase(
          [payload.taskId as string, payload.stepSlug as string],
          config,
          dashboardUrl,
        );
        sendAck(requestId, true);
        break;
      }
      case "continue": {
        executor.spawnPhase(
          [
            payload.taskId as string,
            "continue",
            payload.phase as string,
          ],
          config,
          dashboardUrl,
        );
        sendAck(requestId, true);
        break;
      }
      case "refine": {
        executor.spawnPhase(
          [
            payload.taskId as string,
            "continue",
            payload.phase as string,
          ],
          config,
          dashboardUrl,
          payload.prompt as string,
        );
        sendAck(requestId, true);
        break;
      }
      case "relaunch": {
        executor.spawnPhase(
          [payload.taskId as string, payload.phase as string],
          config,
          dashboardUrl,
        );
        sendAck(requestId, true);
        break;
      }
      case "stop": {
        await executor.stopProcess(
          payload.taskId as string,
          payload.phase as string,
          config,
        );
        sendAck(requestId, true);
        break;
      }
      case "cleanup": {
        await executor.cleanupIssue(
          payload.taskId as string,
          config,
          payload.orgId as string | undefined,
        );
        sendAck(requestId, true);
        break;
      }
      case "devServers": {
        const action = payload.action as string;
        let result: unknown;
        if (action === "start") {
          result = await executor.launchDevServers(
            payload.taskId as string,
            config,
          );
        } else if (action === "stop") {
          await executor.stopDevServers(payload.taskId as string);
          result = { ok: true };
        } else if (action === "status") {
          result = await executor.devServersStatus(config);
        }
        sendAck(requestId, true, result);
        break;
      }
      case "detectTerminals": {
        const home = homedir();
        const exists = async (p: string) => { try { await stat(p); return true; } catch { return false; } };
        const candidates: { id: string; name: string; paths: string[]; binary?: string }[] = process.platform === "darwin"
          ? [
              { id: "ghostty",   name: "Ghostty",     paths: ["/Applications/Ghostty.app",   join(home, "Applications/Ghostty.app")] },
              { id: "iterm2",    name: "iTerm2",       paths: ["/Applications/iTerm.app",     join(home, "Applications/iTerm.app")] },
              { id: "alacritty", name: "Alacritty",   paths: ["/Applications/Alacritty.app", join(home, "Applications/Alacritty.app")] },
              { id: "kitty",     name: "Kitty",       paths: ["/Applications/kitty.app",     join(home, "Applications/kitty.app")] },
              { id: "wezterm",   name: "WezTerm",     paths: ["/Applications/WezTerm.app",   join(home, "Applications/WezTerm.app")] },
              { id: "terminal",  name: "Terminal",    paths: ["/System/Applications/Utilities/Terminal.app"] },
            ]
          : [
              { id: "ghostty",        name: "Ghostty",       paths: [], binary: "ghostty" },
              { id: "kitty",          name: "Kitty",         paths: [], binary: "kitty" },
              { id: "alacritty",      name: "Alacritty",     paths: [], binary: "alacritty" },
              { id: "wezterm",        name: "WezTerm",       paths: [], binary: "wezterm" },
              { id: "gnome-terminal", name: "GNOME Terminal", paths: [], binary: "gnome-terminal" },
              { id: "konsole",        name: "Konsole",       paths: [], binary: "konsole" },
              { id: "xterm",          name: "xterm",         paths: [], binary: "xterm" },
            ];
        const terminals: { id: string; name: string }[] = [];
        for (const t of candidates) {
          const foundPath = (await Promise.all(t.paths.map(exists))).some(Boolean);
          const foundBinary = t.binary
            ? (await exists(`/usr/bin/${t.binary}`) || await exists(`/usr/local/bin/${t.binary}`) || await exists(join(home, ".local/bin", t.binary)))
            : false;
          if (foundPath || foundBinary) terminals.push({ id: t.id, name: t.name });
        }
        sendAck(requestId, true, terminals);
        break;
      }
      case "openTerminal": {
        const result = await executor.openTerminal(
          payload.taskId as string,
          payload.phase as string | undefined,
          (payload.sessionId as string | null) ?? null,
          config,
          payload.terminalId as string | undefined,
        );
        sendAck(requestId, true, result);
        break;
      }
      default:
        sendAck(
          requestId,
          false,
          undefined,
          `Unknown command: ${command}`,
        );
    }
  } catch (err: any) {
    log.error(`${command} failed:`, err.message);
    sendAck(requestId, false, undefined, err.message);
  }
}

export function updateStoredToken(token: string): void {
  storedToken = token;
}

export function disconnect() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (stopMonitor) { stopMonitor(); stopMonitor = null; }
  reconnectTimer = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  connected = false;
}
