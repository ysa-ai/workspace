import { readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import type { AgentConfig } from "./config";
import {
  prepareWorktree,
  runTask,
  getShadowDirsForLanguages,
} from "@ysa-ai/ysa/runtime";
import type { ScopedAllowRule, DetectedLanguage } from "@ysa-ai/ysa/runtime";
import type { TaskHandle } from "@ysa-ai/ysa/types";
import { log } from "../logger";
import { sendToDashboard, requestFromDashboard } from "../ws/send.js";
import { composePrompt } from "./prompt";
import { buildAllowedToolsFromPreset } from "./tools";

export { composePrompt } from "./prompt";
export { buildAllowedToolsFromPreset } from "./tools";

// ─── Types ───────────────────────────────────────────────────────────────

export interface PhaseConfig {
  taskId: string;
  phase: string;
  continueMode: boolean;
  sessionId?: string;
  refinePrompt?: string;
}

export interface RunPhaseResult {
  status: "step_done" | "failed";
  sessionId: string | null;
  error: string | null;
}

interface StepModule {
  name: string;
  prompt: string;
  config?: Record<string, unknown>;
}

export interface StepDefinition {
  slug: string;
  name: string;
  toolPreset: string;
  toolAllowlist: string[] | null;
  containerMode: "readonly" | "readwrite";
  modules: StepModule[];
  promptTemplate: string;
  isLastStep: boolean;
  prevStepResult: string | null;
}

// ─── Step fetching ────────────────────────────────────────────────────────

async function fetchStepDefinition(taskId: string, stepSlug: string): Promise<StepDefinition> {
  const data = await requestFromDashboard<any>({ type: "agent_request", command: "get_workflow", payload: { taskId } });
  const steps: any[] = data.steps ?? [];
  const transitions: any[] = data.transitions ?? [];
  const stepHistory: any[] = data.stepHistory ?? [];
  const step = steps.find((s: any) => s.slug === stepSlug);
  if (!step) throw new Error(`Step "${stepSlug}" not found in workflow for task ${taskId}`);
  const hasForwardTransition = transitions.some((t: any) => t.fromStepId === step.id && t.toStepId !== null);

  let prevStepResult: string | null = null;
  const lastDone = [...stepHistory].reverse().find((h: any) => h.status === "done" && h.slug !== stepSlug);
  if (lastDone) {
    prevStepResult = await requestFromDashboard<string | null>({
      type: "agent_request",
      command: "get_step_result",
      payload: { taskId, stepSlug: lastDone.slug },
    });
  }

  return {
    slug: step.slug,
    name: step.name,
    toolPreset: step.toolPreset ?? "readonly",
    toolAllowlist: step.toolAllowlist ?? null,
    containerMode: step.containerMode ?? "readonly",
    modules: step.modules ?? [],
    promptTemplate: step.promptTemplate ?? "",
    isLastStep: !hasForwardTransition,
    prevStepResult,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function extractScopeFromUrl(repoUrl: string): ScopedAllowRule | null {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    if (url.hostname === "github.com") {
      return { host: "api.github.com", pathPrefix: `/repos/${parts[0]}/${parts[1]}/` };
    }
    return { host: url.hostname, pathPrefix: `/api/v4/projects/${encodeURIComponent(parts.join("/"))}/` };
  } catch {
    return null;
  }
}

function extractProviderScope(issueSource: "gitlab" | "github", issueUrlTemplate: string): ScopedAllowRule | null {
  if (!issueUrlTemplate) return null;
  try {
    const url = new URL(issueUrlTemplate.replace("{id}", "0"));
    if (issueSource === "github") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      return { host: "api.github.com", pathPrefix: `/repos/${parts[0]}/${parts[1]}/` };
    } else {
      const parts = url.pathname.split("/-/");
      if (parts.length < 2) return null;
      const projectPath = parts[0].replace(/^\//, "");
      if (!projectPath) return null;
      return { host: url.hostname, pathPrefix: `/api/v4/projects/${encodeURIComponent(projectPath)}/` };
    }
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

const LANG_DEP_PATTERNS: Partial<Record<string, string[]>> = {
  node:       ["**/package.json", "**/bun.lockb", "**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml"],
  python:     ["**/requirements.txt", "**/poetry.lock", "**/uv.lock", "**/Pipfile.lock"],
  rust:       ["**/Cargo.lock"],
  go:         ["**/go.sum"],
  ruby:       ["**/Gemfile.lock"],
  php:        ["**/composer.lock"],
  "java-maven":  ["**/pom.xml"],
  "java-gradle": ["**/build.gradle", "**/build.gradle.kts"],
  elixir:     ["**/mix.lock"],
  swift:      ["**/Package.resolved"],
  dotnet:     ["**/*.csproj"],
};

async function globFiles(root: string, pattern: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const results: string[] = [];
  for await (const file of glob.scan({ cwd: root, dot: false, onlyFiles: true })) {
    if (!file.includes("node_modules/") && !file.includes("vendor/") && !file.includes(".git/")) {
      results.push(join(root, file));
    }
  }
  return results;
}

async function tryCleanOldDepsVolumes(projectId: string, currentVolumes: string[]): Promise<void> {
  const { stdout } = Bun.spawn(["podman", "volume", "ls", "--format", "{{.Name}}"], { stdout: "pipe" });
  const allVolumes = (await new Response(stdout).text()).trim().split("\n").filter(Boolean);
  const stale = allVolumes.filter((v) => /^shadow-.*-[a-f0-9]{16}$/.test(v) && !currentVolumes.includes(v));
  if (stale.length === 0) return;
  try {
    const { volumesInUse } = await requestFromDashboard<{ volumesInUse: string[] }>({
      type: "agent_request",
      command: "has_active_tasks",
      payload: { projectId },
    });
    const protectedSet = new Set([...currentVolumes, ...volumesInUse]);
    for (const vol of stale) {
      if (!protectedSet.has(vol)) await Bun.spawn(["podman", "volume", "rm", vol]).exited.catch(() => {});
    }
  } catch {}
}

async function computeDepsCacheKey(projectRoot: string, languages: string[], extraFiles: string[]): Promise<string | undefined> {
  const patterns = new Set<string>();
  for (const lang of languages) {
    for (const p of LANG_DEP_PATTERNS[lang] ?? []) patterns.add(p);
  }
  const filePaths = new Set<string>();
  for (const pattern of patterns) {
    for (const f of await globFiles(projectRoot, pattern)) filePaths.add(f);
  }
  for (const f of extraFiles) {
    filePaths.add(f.startsWith("/") ? f : join(projectRoot, f));
  }
  if (filePaths.size === 0) return undefined;
  const hash = createHash("sha1");
  for (const f of [...filePaths].sort()) {
    try { const content = await readFile(f); hash.update(f).update(content); } catch {}
  }
  return hash.digest("hex").slice(0, 16);
}

// ─── Main orchestration ───────────────────────────────────────────────────

export async function runPhase(
  phaseConfig: PhaseConfig,
  config: AgentConfig,
  dashboardUrl: string,
  onHandle?: (handle: TaskHandle) => void,
): Promise<RunPhaseResult> {
  const { taskId, phase, continueMode, sessionId: resumeSessionId } = phaseConfig;
  const worktree = `${config.worktreePrefix}${taskId}`;
  const branch = `${config.branchPrefix}${taskId}`;
  const containerDashboardUrl = dashboardUrl.replace(/localhost|127\.0\.0\.1/, "host.containers.internal");

  const stepDef = await fetchStepDefinition(taskId, phase);
  const allowedTools = buildAllowedToolsFromPreset(stepDef.toolPreset, stepDef.toolAllowlist, config.issueSource ?? "gitlab");

  const submitToken = await requestFromDashboard<string>({
    type: "request_submit_token",
    taskId: Number(taskId),
    projectId: config.projectId ?? "",
    phase,
  });

  if (!continueMode) {
    const userPrompt = config.sourceType === "prompt"
      ? await requestFromDashboard<string | null>({ type: "agent_request", command: "get_user_prompt", payload: { taskId } })
      : null;
    const prompt = await composePrompt(phase, taskId, config, dashboardUrl, stepDef, userPrompt ?? undefined);
    await writeFile(join(worktree, ".ysa-prompt.md"), prompt, "utf-8");
    const deliveredPrompt = `> **CONTEXT RECOVERY:** If your context was compacted and you are unsure about your objectives or how to submit results, re-read \`/workspace/.ysa-prompt.md\` immediately to recover your full instructions.\n\n${prompt}`;
    await requestFromDashboard<unknown>({ type: "agent_request", command: "store_prompt", payload: { taskId, step: phase, content: deliveredPrompt } });
    sendToDashboard({
      type: "status_update",
      taskId,
      status: { step: phase, status: "running", started_at: new Date().toISOString(), finished_at: null, pid: null, session_id: null, error: null },
    });
  }

  if (continueMode) {
    const continuePrompt = phaseConfig.refinePrompt
      ?? "Continue from where you left off. Complete the remaining tasks for this phase. If you are unsure about submission steps or objectives, re-read `/workspace/.ysa-prompt.md`.";
    await requestFromDashboard<unknown>({ type: "agent_request", command: "store_prompt", payload: { taskId, step: phase, content: continuePrompt } });
  }

  const networkPolicy = config.networkPolicy || "none";
  const scopedRules: ScopedAllowRule[] = [];
  if (networkPolicy === "strict") {
    scopedRules.push({ host: new URL(dashboardUrl).hostname, pathPrefix: "/" });
    const providerScope = extractProviderScope(config.issueSource ?? "gitlab", config.issueUrlTemplate);
    if (providerScope) scopedRules.push(providerScope);
    if (config.gitlabProjectId && providerScope) {
      scopedRules.push({ host: providerScope.host, pathPrefix: `/api/v4/projects/${config.gitlabProjectId}/` });
    }
    if (config.codeRepoUrl) {
      const repoScope = extractScopeFromUrl(config.codeRepoUrl);
      if (repoScope) scopedRules.push(repoScope);
    }
  }

  log.info(`${continueMode ? "Resuming" : "Launching"} ${phase} for task #${taskId}`);

  await prepareWorktree(worktree, config.projectRoot, config.envFiles, config.mcpConfig, config.worktreeFiles);

  if (config.npmrcPath) {
    try {
      const srcPath = config.npmrcPath.replace(/^~/, homedir());
      const srcContent = await readFile(srcPath, "utf-8");
      const dstPath = join(worktree, ".npmrc");
      const existing = await readFile(dstPath, "utf-8").catch(() => "");
      const toAppend = srcContent.split("\n").filter((line) => line.trim() && !existing.includes(line.trim())).join("\n");
      if (toAppend) await writeFile(dstPath, existing ? `${existing.trimEnd()}\n${toAppend}\n` : `${toAppend}\n`, "utf-8");
    } catch {}
  }

  const extraEnv: Record<string, string> = {
    DASHBOARD_URL: containerDashboardUrl,
    ISSUE_ID: taskId,
    CONTEXT_ID: taskId,
    ALLOWED_BRANCH: branch,
    YSA_SUBMIT_TOKEN: submitToken,
    PROMPT_TOKEN: submitToken,
    SERVER_PORT: String(config.dashboardPort ?? 3333),
  };

  if (config.defaultCredentialName) {
    const { getCredentialKey } = await import("./keystore.js");
    const key = await getCredentialKey(config.defaultCredentialName);
    if (key) extraEnv[config.llmProvider === "mistral" ? "MISTRAL_API_KEY" : "ANTHROPIC_API_KEY"] = key;
  }

  if (networkPolicy === "strict") {
    const noProxyHosts = new Set(["localhost", "127.0.0.1"]);
    for (const s of config.devServers ?? []) {
      const h = s.host ?? "localhost";
      if (h !== "localhost" && h !== "127.0.0.1") noProxyHosts.add(h);
    }
    const noProxy = Array.from(noProxyHosts).join(",");
    extraEnv.NO_PROXY = noProxy;
    extraEnv.no_proxy = noProxy;
  }

  const langs = (config.languages ?? []) as DetectedLanguage[];
  const projectMiseVolume = config.projectId && langs.length > 0 ? `mise-installs-${config.projectId}` : undefined;
  const depsCacheKey = config.installCmd
    ? await computeDepsCacheKey(config.projectRoot, config.languages ?? [], config.depsCacheFiles ?? [])
    : undefined;

  return new Promise(async (resolve, reject) => {
    const handle = await runTask({
      taskId: [config.orgId, config.projectId, taskId, phase].filter(Boolean).join("-"),
      prompt: "",
      branch,
      projectRoot: config.projectRoot,
      worktreePrefix: config.worktreePrefix,
      provider: config.llmProvider ?? "claude",
      model: config.llmModel,
      maxTurns: config.llmMaxTurns,
      allowedTools: allowedTools.split(",").filter(Boolean),
      resumeSessionId: continueMode ? resumeSessionId : undefined,
      resumeWorktree: worktree,
      networkPolicy: networkPolicy as "none" | "strict" | "custom",
      promptUrl: `${containerDashboardUrl}/api/tasks/${taskId}/prompt?step=${phase}`,
      allowCommit: stepDef.containerMode !== "readonly",
      worktreeFiles: config.worktreeFiles,
      miseVolume: projectMiseVolume,
      depInstallCmd: config.installCmd || undefined,
      depsCacheKey,
      extraEnv,
      extraLabels: { issue: taskId, phase, project: config.projectId ?? "" },
      proxyRules: scopedRules.length > 0 ? scopedRules : undefined,
      serverPort: config.dashboardPort,
    }, {
      onComplete: async (result) => {
        log.info(`Sandbox exited for task #${taskId} (${phase}): ${result.status}`);

        try {
          const mcpPath = join(worktree, ".mcp.json");
          const mcpRaw = await readFile(mcpPath, "utf-8");
          const mcpCfg = JSON.parse(mcpRaw);
          const secrets: string[] = [];
          for (const server of Object.values(mcpCfg.mcpServers ?? {})) {
            const s = server as any;
            if (s.env && typeof s.env === "object") {
              for (const val of Object.values(s.env)) {
                if (typeof val === "string" && val.length >= 8) secrets.push(val);
              }
            }
          }
          if (secrets.length > 0 && await fileExists(result.log_path)) {
            let logContent = await readFile(result.log_path, "utf-8");
            for (const secret of secrets) logContent = logContent.replaceAll(secret, "******");
            await writeFile(result.log_path, logContent, "utf-8");
          }
        } catch {}

        const finalStatus: RunPhaseResult["status"] = result.status === "completed" ? "step_done" : "failed";
        const error = result.error;
        const failureReason = result.failure_reason;

        let planSummary: string | null = null;
        let mrUrl: string | null = null;

        if (result.status !== "stopped" && finalStatus !== "failed") {
          const stepModuleNames = stepDef.modules.map((m) => m.name);
          if (stepModuleNames.includes("delivery")) {
            const moduleText = await requestFromDashboard<string | null>({
              type: "agent_request", command: "get_module_data", payload: { taskId, phase, moduleName: "delivery" },
            });
            if (moduleText) {
              try { mrUrl = JSON.parse(moduleText)?.mr_url ?? null; } catch {}
            }
          }
          if (stepModuleNames.includes("plan")) {
            const planText = await requestFromDashboard<string | null>({
              type: "agent_request", command: "get_module_data", payload: { taskId, phase, moduleName: "plan" },
            });
            if (planText) {
              const titleMatch = planText.match(/\*\*Title:\*\*\s*(.*)/);
              if (titleMatch) planSummary = titleMatch[1].trim();
              else {
                const headingMatch = planText.match(/^#+\s+(.+)/m);
                if (headingMatch) planSummary = headingMatch[1].trim();
              }
            }
          }
          if (stepModuleNames.includes("change_report")) {
            try {
              const diffProc = Bun.spawn(["git", "diff", "HEAD~1..HEAD"], { cwd: worktree, stdout: "pipe", stderr: "pipe" });
              await diffProc.exited;
              const diff = await new Response(diffProc.stdout).text();
              if (diff.trim()) {
                await requestFromDashboard<unknown>({
                  type: "agent_request", command: "store_module_data", payload: { taskId, phase, module: "change_report", data: diff },
                });
              }
            } catch {}
          }
        }

        sendToDashboard({ type: "cleanup_submit_token", taskId: Number(taskId), phase });

        const statusUpdate: Record<string, unknown> = {
          status: result.status === "stopped" ? "stopped" : finalStatus,
          finished_at: new Date().toISOString(),
          pid: null,
          session_id: result.session_id,
          error,
          failure_reason: failureReason,
          elapsed_ms: result.duration_ms,
        };
        if (planSummary) statusUpdate.plan_summary = planSummary;
        if (mrUrl) statusUpdate.mr_url = mrUrl;

        sendToDashboard({ type: "status_update", taskId, status: statusUpdate });

        if (result.status === "stopped") log.info(`Task #${taskId}: stopped`);
        else if (finalStatus === "failed") log.error(`Task #${taskId}: ${finalStatus} — ${error}`);
        else log.success(`Task #${taskId}: ${finalStatus}`);

        resolve({ status: finalStatus, sessionId: result.session_id, error });
      },
      onError: (err) => reject(err),
    });

    onHandle?.(handle);

    if (handle.shadowVolumes.length > 0 && config.projectId) {
      sendToDashboard({ type: "store_deps_volumes", taskId, volumes: handle.shadowVolumes });
      tryCleanOldDepsVolumes(config.projectId, handle.shadowVolumes).catch(() => {});
    }
  });
}
