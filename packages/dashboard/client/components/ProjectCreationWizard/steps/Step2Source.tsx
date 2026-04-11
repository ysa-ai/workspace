import { useForm } from "react-hook-form";
import { WizardField, INPUT, INPUT_MONO, AdvancedSection, StepFooter, confidence } from "../ui";
import type { WizardMode, DetectedConfig } from "../index";

interface Step2Values {
  code_repo_url: string;
  issue_source: "gitlab" | "github";
  issue_url_template: string;
  default_branch: string;
  branch_prefix: string;
}

export function Step2Source({
  mode,
  detected,
  onNext,
  onSkip,
  onBack,
}: {
  mode: WizardMode;
  detected: DetectedConfig | null;
  onNext: (data: Step2Values) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const { register, handleSubmit, watch, setValue } = useForm<Step2Values>({
    defaultValues: {
      code_repo_url: (detected?.repositoryUrl ?? "").replace(/\.git$/, ""),
      issue_source: "gitlab",
      issue_url_template: "",
      default_branch: "main",
      branch_prefix: "fix/",
    },
  });

  const issueSource = watch("issue_source");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Source & repository</h3>
        <p className="text-[13px] text-text-muted">Where should the agent pick up issues and push branches?</p>
      </div>

      <div className="space-y-4">
        <WizardField
          label="Code repository URL"
          hint="URL of the git repository"
          confidence={confidence(detected, "repositoryUrl")}
        >
          <input {...register("code_repo_url")} className={INPUT_MONO} placeholder="https://gitlab.com/org/repo" />
        </WizardField>

        <WizardField label="Issue tracker">
          <div className="flex gap-2">
            {(["gitlab", "github"] as const).map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setValue("issue_source", src)}
                className={`flex-1 py-2 rounded-lg border text-[13px] font-medium transition-colors cursor-pointer ${
                  issueSource === src
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "bg-bg-inset border-border text-text-muted hover:border-border-bright"
                }`}
              >
                {src === "gitlab" ? "GitLab" : "GitHub"}
              </button>
            ))}
          </div>
        </WizardField>

        <WizardField label="Issue URL template" hint={`e.g. https://${issueSource}.com/org/repo/-/issues/{id}`}>
          <input {...register("issue_url_template")} className={INPUT_MONO} placeholder={`https://${issueSource}.com/org/repo/-/issues/{id}`} />
        </WizardField>

        <AdvancedSection>
          <BranchFields register={register} confidence={mode === "autodetect" ? confidence(detected, "repositoryUrl") : undefined} />
        </AdvancedSection>
      </div>

      <StepFooter onBack={onBack} onSkip={onSkip} onNext={handleSubmit(onNext)} />
    </div>
  );
}

function BranchFields({ register, confidence: conf }: { register: any; confidence?: "high" | "medium" | "low" }) {
  return (
    <>
      <WizardField label="Default branch">
        <input {...register("default_branch")} className={INPUT_MONO} placeholder="main" />
      </WizardField>
      <WizardField label="Branch prefix">
        <input {...register("branch_prefix")} className={INPUT_MONO} placeholder="fix/" />
      </WizardField>
    </>
  );
}
