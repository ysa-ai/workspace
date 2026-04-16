import { useState, useEffect } from "react";
import { trpc } from "../../trpc";
import { useToast } from "../Toast";
import { track } from "../../lib/analytics";
import { Step1Basics } from "./steps/Step1Basics";
import { Step2Source } from "./steps/Step2Source";
import { Step3Stack } from "./steps/Step3Stack";
import { Step4AI } from "./steps/Step4AI";
import { Step5Personal } from "./steps/Step5Personal";
import { AutoDetectLoader } from "./AutoDetectLoader";
import { CompletionScreen } from "./CompletionScreen";

export type WizardMode = "manual" | "autodetect";

export interface DetectedConfig {
  repositoryUrl?: string;
  installCommand?: string;
  buildCommand?: string;
  preDevCommand?: string;
  testCommand?: string;
  depsCacheFiles?: string[];
  languageRuntimes?: string[];
  devServers?: { name: string; command: string; port: number }[];
  worktreeFiles?: string[];
  mcpConfigPath?: string;
  envFiles?: string[];
  npmrcPath?: string;
  memoryLimit?: string;
  cpuLimit?: number;
  confidence?: Record<string, "high" | "medium" | "low">;
}

interface DevServerEntry { name: string; cmd: string; port: string; env: string; }

export interface WizardData {
  name: string;
  projectRoot: string;
  code_repo_url: string;
  issue_source: "gitlab" | "github";
  issue_url_template: string;
  default_branch: string;
  branch_prefix: string;
  languages: string[];
  install_cmd: string;
  build_cmd: string;
  test_cmd: string;
  pre_dev_cmd: string;
  deps_cache_files: string;
  dev_servers: DevServerEntry[];
  credentialName: string;
  workflowId: string;
  env_vars: string;
  worktree_files: string;
  mcp_config: string;
  npmrc_path: string;
  container_memory: string;
  container_cpus: number;
  container_pids_limit: number;
  container_timeout: number;
}

const EMPTY_WIZARD_DATA: WizardData = {
  name: "", projectRoot: "",
  code_repo_url: "", issue_source: "gitlab", issue_url_template: "", default_branch: "main", branch_prefix: "fix/",
  languages: [], install_cmd: "", build_cmd: "", test_cmd: "", pre_dev_cmd: "", deps_cache_files: "", dev_servers: [],
  credentialName: "", workflowId: "",
  env_vars: "", worktree_files: "", mcp_config: "", npmrc_path: "",
  container_memory: "4g", container_cpus: 2, container_pids_limit: 512, container_timeout: 3600,
};

const STEP_LABELS = ["Basics", "Source", "Stack", "AI", "Your setup"];

export const DETECTION_PROMPT = `You are performing a headless project configuration detection. Analyze the project at /workspace and output a configuration JSON.

## Task

Explore the project files and detect its build and development setup:

1. Get repository URL: run \`git remote get-url origin\` using a bash tool. If the result is an SSH URL (starts with \`git@\`), convert it to HTTPS — e.g. \`git@github.com:org/repo.git\` → \`https://github.com/org/repo.git\`
2. Read these files if present: \`package.json\`, \`go.mod\`, \`Cargo.toml\`, \`pyproject.toml\`, \`Gemfile\`, \`composer.json\`, \`pom.xml\`, lock files (\`bun.lockb\`, \`package-lock.json\`, \`yarn.lock\`, \`pnpm-lock.yaml\`, \`poetry.lock\`, \`go.sum\`), \`README.md\`, \`Makefile\`, \`docker-compose.yml\`, \`Dockerfile\`, \`.github/workflows/*.yml\`, \`.gitlab-ci.yml\`, \`.mcp.json\`, \`.env\`, \`.env.example\`, \`.npmrc\`, \`mise.toml\`, \`.tool-versions\`

## Output

Write the result to \`/workspace/.ysa-detect.json\`:

\`\`\`json
{
  "repositoryUrl": "",
  "installCommand": "",
  "buildCommand": "",
  "preDevCommand": "",
  "testCommand": "",
  "depsCacheFiles": [],
  "languageRuntimes": [],
  "devServers": [],
  "worktreeFiles": [],
  "mcpConfigPath": "",
  "envFiles": [],
  "npmrcPath": "",
  "memoryLimit": "4g",
  "cpuLimit": 2,
  "confidence": {}
}
\`\`\`

Field guide:
- \`languageRuntimes\`: select only from \`["node","python","go","rust","ruby","php","java-maven","java-gradle","dotnet","c-cpp","elixir"]\`
- \`devServers\`: [{name, command, port}] — look at package.json scripts, Makefile, docker-compose
- \`worktreeFiles\`: files that must be in each git worktree (e.g. \`.env.local\`)
- \`depsCacheFiles\`: key dep files (relative paths)
- \`mcpConfigPath\`: absolute path on the host — use the \`$PROJECT_ROOT\` env var as prefix, e.g. \`$PROJECT_ROOT/.mcp.json\`. Run \`echo $PROJECT_ROOT\` via bash to get the value. Leave empty if no \`.mcp.json\` found
- \`npmrcPath\`: absolute path on the host — use the \`$PROJECT_ROOT\` env var as prefix or \`~/.npmrc\` for the home dir one. Leave empty if not found
- \`envFiles\`: relative paths from project root (e.g. \`apps/api/.env\`)
- \`confidence\`: per-field, one of \`"high"\` (direct evidence), \`"medium"\` (inferred), \`"low"\` (guessed)
- \`memoryLimit\`: \`"2g"\` small, \`"4g"\` medium, \`"8g"\` large monorepo

## Submit

\`\`\`bash
curl -s -X POST $DASHBOARD_URL/api/tasks/$ISSUE_ID/result \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $YSA_SUBMIT_TOKEN" \\
  --data-binary @/workspace/.ysa-detect.json
\`\`\`

Do NOT modify any project files. Do NOT create commits.`;

export function ProjectCreationWizard({
  onClose,
  onSwitchProject,
  onBack,
}: {
  onClose: () => void;
  onSwitchProject?: (projectId: string) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<WizardMode | null>(null);
  const [step, setStep] = useState(1);

  useEffect(() => {
    track("wizard_step_viewed", { step, step_label: STEP_LABELS[step - 1] });
  }, [step]);
  const [detectTaskId, setDetectTaskId] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedConfig | null>(null);
  const [wizardData, setWizardData] = useState<WizardData>(EMPTY_WIZARD_DATA);
  const [isComplete, setIsComplete] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [buildTriggered, setBuildTriggered] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const showToast = useToast();
  const utils = trpc.useUtils();

  const createMutation = trpc.projects.create.useMutation();
  const updateMutation = trpc.projects.update.useMutation();
  const updateUserSettingsMutation = trpc.projects.updateUserSettings.useMutation();
  const upsertCredMutation = trpc.projects.upsertCredentialPreference.useMutation();
  const setWorkflowMutation = trpc.projects.setWorkflow.useMutation();
  const setProjectMutation = trpc.tasks.setProject.useMutation();

  const mergeData = (data: Partial<WizardData>) => setWizardData((d) => ({ ...d, ...data }));

  const handleStep1Done = (step1: { name: string; projectRoot: string }, chosenMode: WizardMode, taskId?: string) => {
    mergeData(step1);
    setMode(chosenMode);
    if (chosenMode === "autodetect" && taskId) {
      setDetectTaskId(taskId);
    } else {
      setStep(2);
    }
  };

  const handleDetected = (config: DetectedConfig) => {
    setDetected(config);
    setDetectTaskId(null);
    setStep(2);
  };

  const handleDetectFailed = () => {
    setDetectTaskId(null);
    setMode("manual");
    setStep(2);
    showToast("Auto-detection failed — continuing manually", "error");
  };

  const handleBack = () => {
    if (step === 1) onBack();
    else setStep((s) => s - 1);
  };

  const handleFinish = async (containerData: Partial<WizardData>) => {
    const data = { ...wizardData, ...containerData };
    setIsSaving(true);
    try {
      const project = await createMutation.mutateAsync({ name: data.name, project_root: data.projectRoot });
      const projectId = project.project_id;
      track("project_created", { mode });

      const depsCacheArr = data.deps_cache_files.split("\n").map((l) => l.trim()).filter(Boolean);
      const devServers = data.dev_servers
        .filter((s) => s.name.trim() || s.cmd.trim())
        .map((s) => ({ name: s.name.trim(), cmd: s.cmd.trim(), port: parseInt(s.port) || 3000 }));
      const worktreeFilesArr = data.worktree_files.split("\n").map((l) => l.trim()).filter(Boolean);

      const updateResult = await updateMutation.mutateAsync({
        projectId,
        code_repo_url: data.code_repo_url || null,
        issue_source: data.issue_source,
        issue_url_template: data.issue_url_template || undefined,
        default_branch: data.default_branch || undefined,
        branch_prefix: data.branch_prefix || undefined,
        languages: data.languages.length ? JSON.stringify(data.languages) : null,
        install_cmd: data.install_cmd || null,
        build_cmd: data.build_cmd || null,
        test_cmd: data.test_cmd || null,
        pre_dev_cmd: data.pre_dev_cmd || null,
        deps_cache_files: depsCacheArr.length ? JSON.stringify(depsCacheArr) : null,
        dev_servers: devServers.length ? JSON.stringify(devServers) : null,
        worktree_files: worktreeFilesArr.length ? JSON.stringify(worktreeFilesArr) : null,
      });

      await updateUserSettingsMutation.mutateAsync({
        projectId,
        env_vars: data.env_vars || null,
        mcp_config: data.mcp_config || null,
        npmrc_path: data.npmrc_path || null,

        container_memory: data.container_memory || null,
        container_cpus: data.container_cpus,
        container_pids_limit: data.container_pids_limit,
        container_timeout: data.container_timeout,
      });

      if (data.credentialName) {
        await upsertCredMutation.mutateAsync({ projectId, defaultCredentialName: data.credentialName });
      }
      if (detectTaskId) {
        await setProjectMutation.mutateAsync({ taskId: parseInt(detectTaskId), projectId });
      }

      utils.projects.invalidate();
      onSwitchProject?.(projectId);
      track("wizard_completed", { mode });
      setSavedProjectId(projectId);
      setBuildTriggered(updateResult.buildTriggered);
      setIsComplete(true);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  function handleClose() {
    if (!isComplete) track("wizard_abandoned", { step, step_label: STEP_LABELS[step - 1] });
    onClose();
  }

  if (isComplete && savedProjectId) {
    return (
      <CompletionScreen
        projectId={savedProjectId}
        detected={detected}
        mode={mode ?? "manual"}
        buildTriggered={buildTriggered}
        onClose={onClose}
      />
    );
  }

  if (detectTaskId) {
    return (
      <AutoDetectLoader
        taskId={detectTaskId}
        onDetected={handleDetected}
        onFailed={handleDetectFailed}
        onClose={onClose}
      />
    );
  }

  const commonProps = { mode: mode ?? "manual", detected };

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-raised">
      <WizardHeader step={step} onClose={handleClose} />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-xl mx-auto">
          {step === 1 && (
            <Step1Basics onDone={handleStep1Done} detectionPrompt={DETECTION_PROMPT} initialName={wizardData.name} initialProjectRoot={wizardData.projectRoot} />
          )}
          {step === 2 && (
            <Step2Source
              {...commonProps}
              onNext={(d) => { mergeData(d); setStep(3); }}
              onSkip={() => setStep(3)}
              onBack={handleBack}
            />
          )}
          {step === 3 && (
            <Step3Stack
              {...commonProps}
              onNext={(d) => { mergeData(d); setStep(4); }}
              onSkip={() => setStep(4)}
              onBack={handleBack}
            />
          )}
          {step === 4 && (
            <Step4AI
              {...commonProps}
              onNext={(d) => { mergeData(d); setStep(5); }}
              onSkip={() => setStep(5)}
              onBack={handleBack}
            />
          )}
          {step === 5 && (
            <Step5Personal
              {...commonProps}
              onNext={(d) => handleFinish(d)}
              onSkip={() => handleFinish({})}
              onBack={handleBack}
              isSaving={isSaving}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WizardHeader({ step, onClose }: { step: number; onClose: () => void }) {
  return (
    <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold tracking-tight">New project</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <div key={n} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                  done ? "bg-primary text-white" : active ? "bg-primary/15 border border-primary text-primary" : "bg-bg-inset border border-border text-text-faint"
                }`}>
                  {done ? (
                    <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : n}
                </div>
                <span className={`text-[11px] font-medium hidden sm:block ${active ? "text-text-primary" : "text-text-faint"}`}>{label}</span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`h-px w-4 shrink-0 ${done ? "bg-primary/40" : "bg-border"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
