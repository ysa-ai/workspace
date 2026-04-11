import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { trpc } from "../../../trpc";
import { WizardField, INPUT, StepFooter } from "../ui";
import type { WizardMode, DetectedConfig } from "../index";

interface Step4Values {
  credentialName: string;
  workflowId: string;
}

export function Step4AI({
  mode,
  detected,
  onNext,
  onSkip,
  onBack,
}: {
  mode: WizardMode;
  detected: DetectedConfig | null;
  onNext: (data: Step4Values) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const { data: credentialsData } = trpc.projects.listCredentials.useQuery();
  const { data: workflows = [] } = trpc.workflows.list.useQuery();
  const credentials = credentialsData?.credentials ?? [];
  const agentConnected = trpc.system.agentConnected.useQuery(undefined, { refetchInterval: 5000 });

  const { register, handleSubmit, setValue, watch } = useForm<Step4Values>({
    defaultValues: { credentialName: "", workflowId: "" },
  });

  const credentialName = watch("credentialName");

  useEffect(() => {
    const first = (credentials as any[])[0];
    if (first) setValue("credentialName", first.name);
  }, [(credentials as any[])[0]?.name]);

  useEffect(() => {
    const first = (workflows as any[])[0];
    if (first) setValue("workflowId", String(first.id));
  }, [(workflows as any[])[0]?.id]);

  const canProceed = agentConnected.data && credentials.length > 0 && !!credentialName;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">AI configuration</h3>
        <p className="text-[13px] text-text-muted">Which AI credential and workflow should run on this project?</p>
      </div>

      <div className="space-y-4">
        <WizardField label="Credential">
          {!agentConnected.data ? (
            <div className="p-3 rounded-lg bg-warn/5 border border-warn/20 text-[12px] text-warn">
              Agent not connected — credentials unavailable
            </div>
          ) : credentials.length === 0 ? (
            <div className="p-3 rounded-lg bg-bg-inset border border-border text-[12px] text-text-muted">
              No credentials configured. Run <code className="font-mono text-text-primary">ysa-agent credential add</code> in your terminal, then refresh.
            </div>
          ) : (
            <select {...register("credentialName", { required: true })} className={INPUT}>
              {(credentials as any[]).map((c: any) => (
                <option key={c.name} value={c.name}>{c.name} ({c.provider})</option>
              ))}
            </select>
          )}
        </WizardField>

        {(workflows as any[]).length > 0 && (
          <WizardField label="Workflow">
            <select {...register("workflowId")} className={INPUT}>
              {(workflows as any[]).map((wf: any) => (
                <option key={wf.id} value={String(wf.id)}>{wf.name}</option>
              ))}
            </select>
          </WizardField>
        )}
      </div>

      <StepFooter onBack={onBack} onSkip={onSkip} onNext={handleSubmit(onNext)} nextDisabled={!canProceed} />
    </div>
  );
}
