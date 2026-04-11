import { useForm } from "react-hook-form";
import { WizardField, INPUT_MONO, AdvancedSection, StepFooter, confidence } from "../ui";
import type { WizardMode, DetectedConfig } from "../index";

interface Step6Values {
  container_memory: string;
  container_cpus: number;
  container_pids_limit: number;
  container_timeout: number;
}

export function Step6Container({
  mode,
  detected,
  onNext,
  onSkip,
  onBack,
  isSaving,
}: {
  mode: WizardMode;
  detected: DetectedConfig | null;
  onNext: (data: Step6Values) => void;
  onSkip: () => void;
  onBack: () => void;
  isSaving?: boolean;
}) {
  const { register, handleSubmit } = useForm<Step6Values>({
    defaultValues: {
      container_memory: detected?.memoryLimit ?? "4g",
      container_cpus: detected?.cpuLimit ?? 2,
      container_pids_limit: 512,
      container_timeout: 3600,
    },
  });

  const fields = (
    <>
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
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Container settings</h3>
        <p className="text-[13px] text-text-muted">Resource limits for the agent's sandbox container.</p>
      </div>

      <div className="space-y-4">
        {mode === "autodetect" ? fields : <AdvancedSection>{fields}</AdvancedSection>}
      </div>

      <StepFooter onBack={onBack} onSkip={onSkip} onNext={handleSubmit(onNext)} isPending={isSaving} nextLabel="Finish" />
    </div>
  );
}
