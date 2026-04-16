import { stat, readFile, mkdir, writeFile, appendFile, rm, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { AgentConfig } from "./config";
import { runPhase, buildAllowedToolsFromPreset } from "./phase-runner";
import type { TaskHandle } from "@ysa-ai/ysa/types";
import {
  createWorktree,
  prepareWorktree,
  runTask,
  teardownContainer,
  removeWorktree,
  runInteractive,
  projectImageName,
  installRuntimes,
  getMiseToolsForLanguages,
  getShadowDirsForLanguages,
} from "@ysa-ai/ysa/runtime";
import type { DetectedLanguage } from "@ysa-ai/ysa/runtime";
import { getProvider } from "@ysa-ai/shared";
import { log } from "../logger";
import { sendToDashboard, requestFromDashboard } from "../ws/send.js";


const devWindowIds = new Map<string, string>();
const activeHandles = new Map<string, TaskHandle>();

async function writeInitLog(logPath: string, subtype: "section" | "progress", message: string) {
  try {
    await mkdir(join(logPath, ".."), { recursive: true });
    await appendFile(logPath, JSON.stringify({ type: "system", subtype, message }) + "\n");
  } catch {}
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runShell(
  cmd: string,
  cwd?: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", "-c", cmd], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function runDetect(id: number, config: AgentConfig, dashboardUrl: string) {
  const containerDashboardUrl = dashboardUrl.replace(/localhost|127\.0\.0\.1/, "host.containers.internal");
  const taskId = String(id);
  const phase = "detect";

  sendToDashboard({ type: "status_update", taskId, status: { step: phase, status: "running", started_at: new Date().toISOString(), finished_at: null } });

  const submitToken = await requestFromDashboard<string>({ type: "request_submit_token", taskId: id, projectId: "", phase });

  const extraEnv: Record<string, string> = {
    DASHBOARD_URL: containerDashboardUrl,
    ISSUE_ID: taskId,
    CONTEXT_ID: taskId,
    YSA_SUBMIT_TOKEN: submitToken,
    PROMPT_TOKEN: submitToken,
    SERVER_PORT: String(config.dashboardPort ?? 3333),
  };

  if (config.defaultCredentialName) {
    const { getCredentialKey } = await import("./keystore.js");
    const key = await getCredentialKey(config.defaultCredentialName);
    if (key) extraEnv["ANTHROPIC_API_KEY"] = key;
  }

  const allowedTools = buildAllowedToolsFromPreset("readonly", null, "gitlab");

  const failStatus = async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    sendToDashboard({ type: "cleanup_submit_token", taskId: id, phase });
    sendToDashboard({ type: "status_update", taskId, status: { phase, status: "failed", finished_at: new Date().toISOString(), error: message } });
  };

  try {
    const handle = await runTask({
      taskId: `${taskId}-${phase}`,
      prompt: "",
      branch: `detect-${taskId}`,
      projectRoot: config.projectRoot,
      worktreePrefix: config.worktreePrefix,
      provider: config.llmProvider ?? "claude",
      model: config.llmModel,
      maxTurns: config.llmMaxTurns ?? 30,
      allowedTools: allowedTools.split(",").filter(Boolean),
      networkPolicy: "none",
      promptUrl: `${containerDashboardUrl}/api/tasks/${taskId}/prompt?step=${phase}`,
      allowCommit: false,
      worktreeFiles: [],
      extraEnv,
      extraLabels: { issue: taskId, phase, project: "" },
      serverPort: config.dashboardPort,
    }, {
      onComplete: async (result) => {
        sendToDashboard({ type: "cleanup_submit_token", taskId: id, phase });
        const finalStatus = result.status === "completed" ? "done" : "failed";
        sendToDashboard({ type: "status_update", taskId, status: { step: phase, status: finalStatus, finished_at: new Date().toISOString(), error: result.error ?? null } });
        const worktree = `${config.worktreePrefix}${taskId}-${phase}`;
        await removeWorktree(config.projectRoot, worktree, `detect-${taskId}`).catch(() => {});
      },
    });
    activeHandles.set(taskId, handle);
    handle.wait().finally(() => activeHandles.delete(taskId));
  } catch (e) {
    await failStatus(e);
  }
}

export function spawnPhase(
  args: string[],
  config: AgentConfig,
  dashboardUrl: string,
  refinePrompt?: string,
) {
  const issueId = args[0];
  let phase: string;
  let continueMode = false;
  let sessionId: string | undefined;

  if (args[1] === "continue") {
    continueMode = true;
    phase = args[2];
  } else {
    phase = args[1];
  }

  const failStatus = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`spawnPhase error for task #${issueId}:`, message);
    sendToDashboard({ type: "status_update", taskId: issueId, status: { step: phase, status: "failed", finished_at: new Date().toISOString(), error: message, failure_reason: "infrastructure" } });
  };

  const onHandle = (handle: TaskHandle) => {
    activeHandles.set(issueId, handle);
    handle.wait().finally(() => activeHandles.delete(issueId));
  };

  if (continueMode) {
    const compoundId = [config.orgId, config.projectId, issueId, phase].filter(Boolean).join("-");
    const logPath = join(config.projectRoot, ".ysa", "logs", `${compoundId}.log`);
    readFile(logPath, "utf-8")
      .catch(() => "")
      .then((content) => {
        const matches = content.match(/"session_id":"([^"]*)"/g);
        if (matches) {
          const last = matches[matches.length - 1];
          const id = last.match(/"session_id":"([^"]*)"/)?.[1];
          if (id) sessionId = id;
        }
        return runPhase({ taskId: issueId, phase, continueMode, sessionId, refinePrompt }, config, dashboardUrl, onHandle);
      })
      .catch(failStatus);
  } else {
    runPhase({ taskId: issueId, phase, continueMode }, config, dashboardUrl, onHandle).catch(failStatus);
  }
}

export async function runInit(
  issues: number[],
  dashboardUrl: string,
  config: AgentConfig,
) {
  if (config.sourceType === "detect") {
    for (const id of issues) runDetect(id, config, dashboardUrl);
    return;
  }

  const branch = config.defaultBranch ?? "main";
  const pull = await runShell(
    `GIT_TERMINAL_PROMPT=0 git -C ${config.projectRoot} checkout ${branch} && GIT_TERMINAL_PROMPT=0 git -C ${config.projectRoot} pull origin ${branch}`,
  );
  if (!pull.ok) {
    const isAuthError = pull.stderr.includes("Authentication failed")
      || pull.stderr.includes("could not read Username")
      || pull.stderr.includes("terminal prompts disabled")
      || pull.stderr.includes("Permission denied");
    if (isAuthError) {
      const remote = pull.stderr.match(/https?:\/\/[^\s']+/)?.[0] ?? config.projectRoot;
      const msg = `Git authentication failed for ${remote}. Run \`git pull\` manually in your project directory to cache credentials, or switch your remote to SSH.`;
      log.error(msg);
      for (const id of issues) {
        sendToDashboard({ type: "status_update", taskId: String(id), status: { status: "failed", error: msg, finished_at: new Date().toISOString() } });
      }
      return;
    }
    log.warn("Failed to update branch:", pull.stderr);
  }

  for (const id of issues) {
    const worktree = `${config.worktreePrefix}${id}`;
    const branch = config.branchOverrides?.[String(id)] ?? `${config.branchPrefix}${id}`;

    try {
      const wt = await createWorktree(config.projectRoot, worktree, branch);
      if (!wt.ok) {
        sendToDashboard({ type: "status_update", taskId: String(id), status: { status: "failed", error: `Worktree creation failed: ${wt.error}`, finished_at: new Date().toISOString() } });
        continue;
      }

      // Resolve first step slug early so we can write progress to the log file
      let firstStepSlug = "";
      try {
        const wf = await requestFromDashboard<any>({ type: "agent_request", command: "get_workflow", payload: { taskId: String(id) } });
        firstStepSlug = wf.steps?.[0]?.slug ?? "";
      } catch { /* */ }

      const logDir = join(config.projectRoot, ".ysa", "logs");
      const initLogPath = join(logDir, `${id}-${firstStepSlug}.log`);

      // Copy .npmrc before install so private registry credentials are available
      if (config.npmrcPath) {
        try {
          const srcPath = config.npmrcPath.replace(/^~/, homedir());
          const srcContent = await readFile(srcPath, "utf-8");
          const dstPath = join(worktree, ".npmrc");
          const existing = await readFile(dstPath, "utf-8").catch(() => "");
          const toAppend = srcContent
            .split("\n")
            .filter((line) => line.trim() && !existing.includes(line.trim()))
            .join("\n");
          if (toAppend) {
            await writeFile(dstPath, existing ? `${existing.trimEnd()}\n${toAppend}\n` : `${toAppend}\n`, "utf-8");
          }
        } catch { /* npmrc not readable — skip silently */ }
      }

      await writeInitLog(initLogPath, "section", "Worktree init");
      await writeInitLog(initLogPath, "progress", "Setting up worktree...");

      if (config.buildCmd) {
        await writeInitLog(initLogPath, "progress", "Building packages...");
        const buildResult = await runShell(
          `cd ${worktree} && ${config.buildCmd}`,
        );
        if (!buildResult.ok)
          log.error(`Build failed for task #${id}:`, buildResult.stderr);
      }

      if (config.preDevCmd) {
        await writeInitLog(initLogPath, "progress", "Running pre-dev command...");
        const preDevResult = await runShell(
          `cd ${worktree} && ${config.preDevCmd}`,
        );
        if (!preDevResult.ok)
          log.error(`Pre-dev command failed for task #${id}:`, preDevResult.stderr);
      }

      // Prepare worktree (copy .mcp.json + env files)
      await prepareWorktree(worktree, config.projectRoot, config.envFiles, config.mcpConfig, config.worktreeFiles);

      await writeInitLog(initLogPath, "section", "Container init");
      log.info(`Launching ${firstStepSlug} for task #${id}`);
      spawnPhase([String(id), firstStepSlug], config, dashboardUrl);
    } catch (e: any) {
      log.error(`Init error for task #${id}:`, e);
      sendToDashboard({ type: "status_update", taskId: String(id), status: { status: "failed", error: e.message, finished_at: new Date().toISOString() } });
    }
  }
}

export async function stopProcess(
  issueId: string,
  phase: string,
  config: AgentConfig,
): Promise<void> {
  const handle = activeHandles.get(issueId);
  if (handle) {
    await handle.stop();
  }
}

export async function cleanupIssue(
  issueId: string,
  config: AgentConfig,
  orgId?: string,
) {
  await teardownContainer(issueId, { labels: { issue: issueId, project: config.projectId ?? "" } });

  const worktree = `${config.worktreePrefix}${issueId}`;
  const branch = `${config.branchPrefix}${issueId}`;
  await removeWorktree(config.projectRoot, worktree, branch);

  const issueDir = join(config.issuesDir, issueId);
  await rm(issueDir, { recursive: true, force: true });

  const prefix = [orgId, config.projectId, issueId].filter(Boolean).join("-") + "-";

  const logDir = join(config.projectRoot, ".ysa", "logs");
  const logFiles = await readdir(logDir).catch(() => [] as string[]);
  await Promise.all(
    logFiles
      .filter((f) => f.startsWith(prefix) && f.endsWith(".log"))
      .map((f) => rm(join(logDir, f), { force: true })),
  );

  const proxyLogDir = join(homedir(), ".ysa", "proxy-logs");
  const proxyFiles = await readdir(proxyLogDir).catch(() => [] as string[]);
  await Promise.all(
    proxyFiles
      .filter((f) => f.startsWith(prefix) && f.endsWith(".log"))
      .map((f) => rm(join(proxyLogDir, f), { force: true })),
  );
}

export async function launchDevServers(
  issueId: string,
  config: AgentConfig,
) {
  if (process.platform !== "darwin") {
    throw new Error("Dev server terminal launch is not supported on this platform");
  }

  if (config.devServers.length === 0) {
    throw new Error("No DEV_SERVERS configured");
  }

  const worktree = `${config.worktreePrefix}${issueId}`;
  if (!(await fileExists(worktree))) {
    throw new Error(`Worktree not found: ${worktree}`);
  }

  if (config.preDevCmd) {
    log.info(`Running pre-dev command for issue #${issueId}...`);
    const preDevResult = await runShell(`cd ${worktree} && ${config.preDevCmd}`, worktree);
    if (!preDevResult.ok)
      log.error(`Pre-dev command failed for issue #${issueId}:`, preDevResult.stderr);
  }

  const servers = config.devServers;
  const envStr = (env?: Record<string, string>) =>
    env
      ? Object.entries(env)
          .map(([k, v]) => `${k}='${v}'`)
          .join(" ") + " "
      : "";
  const shellCmd = (s: (typeof servers)[0]) =>
    `cd ${worktree} && ${envStr(s.env)}${s.cmd}`;
  const asStr = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const first = servers[0];
  let script = `
    tell application "iTerm2"
      activate
      set devWin to (create window with default profile)
      tell current session of devWin
        write text "${asStr(shellCmd(first))}"
        set name to "Dev-${issueId}-${first.name}"
      end tell`;

  for (let i = 1; i < servers.length; i++) {
    const s = servers[i];
    script += `
      tell devWin
        set newTab to (create tab with default profile)
        tell current session of newTab
          write text "${asStr(shellCmd(s))}"
          set name to "Dev-${issueId}-${s.name}"
        end tell
      end tell`;
  }

  script += `
      id of devWin
    end tell`;

  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const winId = stdout.trim();
  if (winId) devWindowIds.set(issueId, winId);

  return {
    launched: servers.map((s) => ({ name: s.name, port: s.port })),
  };
}

export async function stopDevServers(issueId: string) {
  if (process.platform !== "darwin") {
    throw new Error("Dev server terminal launch is not supported on this platform");
  }

  const winId = devWindowIds.get(issueId);
  if (!winId)
    throw new Error("No tracked dev server window for this issue");

  const script = `
    tell application "iTerm2"
      close window id ${winId}
    end tell`;
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  devWindowIds.delete(issueId);
}

export async function devServersStatus(config: AgentConfig) {
  const results: { name: string; port: number; running: boolean }[] = [];
  for (const server of config.devServers) {
    const check = await runShell(
      `lsof -i :${server.port} -sTCP:LISTEN -t 2>/dev/null`,
    );
    results.push({
      name: server.name,
      port: server.port,
      running: check.ok && check.stdout.length > 0,
    });
  }
  return { running: results.some((r) => r.running), servers: results };
}

async function openInTerminal(launcherPath: string, shortId: string, terminalId: string): Promise<void> {
  if (process.platform === "darwin") {
    if (terminalId === "ghostty") {
      const script = `
        tell application "Ghostty"
          activate
          tell application "System Events" to tell process "Ghostty"
            keystroke "n" using command down
          end tell
          delay 0.4
          tell application "System Events" to tell process "Ghostty"
            keystroke "bash ${launcherPath}"
            key code 36
          end tell
        end tell`;
      Bun.spawn(["osascript", "-e", script], { stdout: "ignore", stderr: "ignore" });
      return;
    }
    if (terminalId === "iterm2") {
      const script = `
        tell application "iTerm2"
          activate
          create window with default profile
          tell current session of current window
            write text "bash ${launcherPath}"
            set name to "sandbox-${shortId}"
          end tell
        end tell`;
      Bun.spawn(["osascript", "-e", script], { stdout: "ignore", stderr: "ignore" });
      return;
    }
    if (terminalId === "alacritty") {
      Bun.spawn(["open", "-a", "Alacritty", "--args", "-e", "bash", launcherPath], { stdout: "ignore", stderr: "ignore" });
      return;
    }
    if (terminalId === "kitty") {
      Bun.spawn(["open", "-a", "kitty", "--args", "bash", launcherPath], { stdout: "ignore", stderr: "ignore" });
      return;
    }
    if (terminalId === "wezterm") {
      Bun.spawn(["open", "-a", "WezTerm", "--args", "start", "--", "bash", launcherPath], { stdout: "ignore", stderr: "ignore" });
      return;
    }
    // terminal or fallback
    const script = `tell application "Terminal"
      activate
      do script "bash ${launcherPath}"
    end tell`;
    Bun.spawn(["osascript", "-e", script], { stdout: "ignore", stderr: "ignore" });
    return;
  }

  // Linux
  const linuxCommands: Record<string, string[]> = {
    ghostty:          ["ghostty", "-e", "bash", launcherPath],
    kitty:            ["kitty", "bash", launcherPath],
    alacritty:        ["alacritty", "-e", "bash", launcherPath],
    wezterm:          ["wezterm", "start", "--", "bash", launcherPath],
    "gnome-terminal": ["gnome-terminal", "--", "bash", launcherPath],
    konsole:          ["konsole", "-e", "bash", launcherPath],
    xterm:            ["xterm", "-e", "bash", launcherPath],
  };
  const cmd = linuxCommands[terminalId];
  if (cmd) {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  }
}

export async function openTerminal(
  issueId: string,
  phase: string | undefined,
  sessionIdFallback: string | null,
  config: AgentConfig,
  terminalId?: string,
) {
  let sessionId = sessionIdFallback;

  const compoundId = [config.orgId, config.projectId, issueId, phase].filter(Boolean).join("-");

  if (phase) {
    const logPath = join(config.projectRoot, ".ysa", "logs", `${compoundId}.log`);
    if (await fileExists(logPath)) {
      const logContent = await readFile(logPath, "utf-8");
      const matches = logContent.match(/"session_id":"([^"]*)"/g);
      if (matches) {
        const last = matches[matches.length - 1];
        const id = last.match(/"session_id":"([^"]*)"/)?.[1];
        if (id) sessionId = id;
      }
    }
  }

  const worktree = `${config.worktreePrefix}${issueId}`;

  // Copy .mcp.json into worktree for MCP server discovery
  const mcpSrc = config.mcpConfig || join(config.projectRoot, ".mcp.json");
  const mcpDst = join(worktree, ".mcp.json");
  if (await fileExists(mcpSrc)) {
    await Bun.write(mcpDst, await readFile(mcpSrc));
  }

  const langs = (config.languages ?? []) as DetectedLanguage[];
  const shadowDirs = getShadowDirsForLanguages(langs);

  const submitToken = await requestFromDashboard<string>({
    type: "request_submit_token",
    taskId: Number(issueId),
    projectId: config.projectId ?? "",
    phase: phase ?? "",
  });

  const runConfig = {
    taskId: compoundId,
    prompt: "",
    branch: `${config.branchPrefix}${issueId}`,
    projectRoot: config.projectRoot,
    worktreePrefix: config.worktreePrefix,
    provider: config.llmProvider ?? "claude",
    model: config.llmModel,
    resumeSessionId: sessionId ?? undefined,
    resumeWorktree: worktree,
    networkPolicy: config.networkPolicy,
    worktreeFiles: config.worktreeFiles,
    shadowDirs,
    extraEnv: { YSA_SUBMIT_TOKEN: submitToken, PROMPT_TOKEN: submitToken },
  };

  const configPath = `/tmp/ysa-refine-${compoundId}.json`;
  const launcherPath = `/tmp/ysa-refine-${compoundId}.sh`;
  await writeFile(configPath, JSON.stringify(runConfig), { mode: 0o644 });
  const esc = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  // In compiled binary mode, process.argv[1] is an internal bunfs path; in script mode it's the .js file
  const isCompiled = process.argv[1]?.includes("/$bunfs/") ?? false;
  const launcherCmd = isCompiled
    ? `${esc(process.execPath)} _refine-file ${esc(configPath)}`
    : `${esc(process.execPath)} ${esc(process.argv[1] ?? "")} _refine-file ${esc(configPath)}`;
  await writeFile(launcherPath, `#!/bin/bash\nexec ${launcherCmd}\n`, { mode: 0o755 });
  await openInTerminal(launcherPath, issueId.slice(0, 8), terminalId ?? "iterm2");

  return { session_id: sessionId };
}
