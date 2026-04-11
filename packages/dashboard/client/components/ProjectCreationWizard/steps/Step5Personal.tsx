import { useState } from "react";
import { useForm } from "react-hook-form";
import { trpc } from "../../../trpc";
import { useToast } from "../../Toast";
import { WizardField, INPUT_MONO, AdvancedSection, StepFooter, confidence } from "../ui";
import type { WizardMode, DetectedConfig } from "../index";

interface Step5Values {
  env_vars: string;
  worktree_files: string;
  mcp_config: string;
  npmrc_path: string;
  container_memory: string;
  container_cpus: number;
  container_pids_limit: number;
  container_timeout: number;
}

export function Step5Personal({
  mode,
  detected,
  onNext,
  onSkip,
  onBack,
  isSaving,
}: {
  mode: WizardMode;
  detected: DetectedConfig | null;
  onNext: (data: Step5Values) => void;
  onSkip: () => void;
  onBack: () => void;
  isSaving?: boolean;
}) {
  const showToast = useToast();
  const [pickingField, setPickingField] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue } = useForm<Step5Values>({
    defaultValues: {
      env_vars: (detected?.envFiles ?? []).join(","),
      worktree_files: (detected?.worktreeFiles ?? []).join("\n"),
      mcp_config: detected?.mcpConfigPath ?? "",
      npmrc_path: detected?.npmrcPath ?? "",
      container_memory: detected?.memoryLimit ?? "4g",
      container_cpus: detected?.cpuLimit ?? 2,
      container_pids_limit: 512,
      container_timeout: 3600,
    },
  });

  const pickFileMutation = trpc.projects.pickFile.useMutation();
  const browse = (field: keyof Step5Values, prompt: string, append = false) => {
    setPickingField(field);
    pickFileMutation.mutate(
      { prompt },
      {
        onSuccess: (data) => {
          if (data.path) {
            if (append) {
              const current = watch(field) as string;
              setValue(field, current ? `${current},${data.path}` : data.path);
            } else {
              setValue(field, data.path);
            }
          }
          setPickingField(null);
        },
        onError: (err) => {
          showToast(err.message, "error");
          setPickingField(null);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Your setup</h3>
        <p className="text-[13px] text-text-muted">These are stored only on your machine and never sent to our servers.</p>
      </div>

      <div className="p-3 rounded-lg bg-bg-inset border border-border text-[12px] text-text-muted">
        These settings are <strong className="text-text-primary">only visible to you</strong> — local paths specific to your machine.
      </div>

      <div className="space-y-4">
        <WizardField label="Env files" hint="Comma-separated .env file paths on your machine" confidence={confidence(detected, "envFiles")}>
          <div className="flex gap-2">
            <input {...register("env_vars")} className={`${INPUT_MONO} flex-1 min-w-0`} placeholder=".env,apps/api/.env" />
            <button type="button" onClick={() => browse("env_vars", "Select .env file", true)} disabled={pickingField !== null} className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-all cursor-pointer disabled:opacity-50">
              {pickingField === "env_vars" ? "…" : "Browse"}
            </button>
          </div>
        </WizardField>

        <AdvancedSection>
          <WizardField label="Worktree files" hint="Files copied into each git worktree (one per line)" confidence={confidence(detected, "worktreeFiles")}>
            <textarea
              {...register("worktree_files")}
              className={`${INPUT_MONO} resize-none text-[11px]`}
              rows={3}
              placeholder={".env.local\n.npmrc"}
            />
          </WizardField>

          <WizardField label="MCP config path" hint="Path to .mcp.json on your machine" confidence={confidence(detected, "mcpConfigPath")}>
            <div className="flex gap-2">
              <input {...register("mcp_config")} className={`${INPUT_MONO} flex-1 min-w-0`} placeholder="/path/to/.mcp.json" />
              <button type="button" onClick={() => browse("mcp_config", "Select MCP config file")} disabled={pickingField !== null} className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-all cursor-pointer disabled:opacity-50">
                {pickingField === "mcp_config" ? "…" : "Browse"}
              </button>
            </div>
          </WizardField>

          <WizardField label="npmrc path" hint="Path to .npmrc with private registry credentials" confidence={confidence(detected, "npmrcPath")}>
            <div className="flex gap-2">
              <input {...register("npmrc_path")} className={`${INPUT_MONO} flex-1 min-w-0`} placeholder="~/.npmrc" />
              <button type="button" onClick={() => browse("npmrc_path", "Select .npmrc file")} disabled={pickingField !== null} className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-all cursor-pointer disabled:opacity-50">
                {pickingField === "npmrc_path" ? "…" : "Browse"}
              </button>
            </div>
          </WizardField>

          <WizardField label="Memory limit" hint="e.g. 4g, 8g" confidence={confidence(detected, "memoryLimit")}>
            <input {...register("container_memory")} className={INPUT_MONO} placeholder="4g" />
          </WizardField>
          <WizardField label="CPU limit" confidence={confidence(detected, "cpuLimit")}>
            <input type="number" {...register("container_cpus", { valueAsNumber: true })} className={INPUT_MONO} min={1} max={16} />
          </WizardField>
          <WizardField label="PID limit">
            <input type="number" {...register("container_pids_limit", { valueAsNumber: true })} className={INPUT_MONO} min={64} />
          </WizardField>
          <WizardField label="Timeout (seconds)">
            <input type="number" {...register("container_timeout", { valueAsNumber: true })} className={INPUT_MONO} min={60} />
          </WizardField>
        </AdvancedSection>
      </div>

      <StepFooter onBack={onBack} onSkip={onSkip} onNext={handleSubmit(onNext)} isPending={isSaving} nextLabel="Finish" />
    </div>
  );
}
