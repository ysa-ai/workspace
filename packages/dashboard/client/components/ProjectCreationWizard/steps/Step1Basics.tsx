import { useState } from "react";
import { useForm } from "react-hook-form";
import { trpc } from "../../../trpc";
import { useToast } from "../../Toast";
import type { WizardMode } from "../index";

interface Step1Values {
  name: string;
  projectRoot: string;
}

export function Step1Basics({
  onDone,
  detectionPrompt,
  initialName = "",
  initialProjectRoot = "",
}: {
  onDone: (values: { name: string; projectRoot: string }, mode: WizardMode, detectTaskId?: string) => void;
  detectionPrompt: string;
  initialName?: string;
  initialProjectRoot?: string;
}) {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Step1Values>({
    defaultValues: { name: initialName, projectRoot: initialProjectRoot },
  });
  const [pickingDir, setPickingDir] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const showToast = useToast();

  const detectMutation = trpc.actions.detect.useMutation();
  const pickDirectoryMutation = trpc.projects.pickDirectory.useMutation();
  const validateRootMutation = trpc.projects.validateProjectRoot.useMutation();

  const name = watch("name");
  const projectRoot = watch("projectRoot");

  const setProjectRoot = (path: string) => {
    const cleaned = path.replace(/\/+$/, "").replace(/\/.git$/, "");
    const input = document.getElementById("wizard-project-root") as HTMLInputElement;
    if (input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeInputValueSetter?.call(input, cleaned);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setRootError(null);
    validateRootMutation.mutate({ path: cleaned }, {
      onSuccess: (res) => { if (!res.ok) setRootError(res.error ?? "Invalid project root"); },
      onError: () => {},
    });
  };

  const browse = () => {
    setPickingDir(true);
    pickDirectoryMutation.mutate(undefined, {
      onSuccess: (data) => {
        if (data.path) setProjectRoot(data.path);
        setPickingDir(false);
      },
      onError: (err) => {
        showToast(err.message, "error");
        setPickingDir(false);
      },
    });
  };

  const submit = handleSubmit(async (values, event) => {
    const btn = (event?.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLButtonElement | null;
    const chosenMode = (btn?.dataset.mode ?? "manual") as WizardMode;

    try {
      if (chosenMode === "autodetect") {
        const result = await detectMutation.mutateAsync({
          projectRoot: values.projectRoot,
          prompt: detectionPrompt,
          llmMaxTurns: 30,
        });
        onDone({ name: values.name, projectRoot: values.projectRoot }, "autodetect", String(result.taskId));
      } else {
        onDone({ name: values.name, projectRoot: values.projectRoot }, "manual");
      }
    } catch (err: any) {
      showToast(err.message, "error");
    }
  });

  const isPending = detectMutation.isPending || pickingDir || validateRootMutation.isPending;
  const canProceed = name.trim() && projectRoot.trim() && !isPending && !rootError;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Project basics</h3>
        <p className="text-[13px] text-text-muted">Name your project and point to the local repository. Everything else can be configured in the next steps.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[13px] font-semibold mb-1.5">
            Project name <span className="text-err">*</span>
          </label>
          <input
            {...register("name", { required: true })}
            className="w-full bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
            placeholder="my-project"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-[13px] font-semibold mb-1.5">Project root <span className="text-err">*</span></label>
          <div className="flex gap-2">
            <input
              id="wizard-project-root"
              {...register("projectRoot")}
              className="w-full bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all font-mono flex-1 min-w-0"
              placeholder="/path/to/repo"
            />
            <button
              type="button"
              onClick={browse}
              disabled={pickingDir}
              className="shrink-0 px-3 py-2 bg-bg-inset border border-border rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:border-border-bright transition-all cursor-pointer disabled:opacity-50"
            >
              {pickingDir ? "…" : "Browse"}
            </button>
          </div>
          {rootError
            ? <p className="text-[11px] text-err mt-1">{rootError}</p>
            : <p className="text-[11px] text-text-faint mt-1">Absolute path to the repository on your machine</p>
          }
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="submit"
            data-mode="autodetect"
            disabled={!canProceed}
            className="flex flex-col items-start gap-1.5 p-4 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary shrink-0">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" strokeLinecap="round" />
              </svg>
              <span className="text-[13px] font-semibold text-primary">Auto-detect</span>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">Let AI analyze your repo and fill in every setting automatically</p>
          </button>

          <button
            type="submit"
            data-mode="manual"
            disabled={!canProceed}
            className="flex flex-col items-start gap-1.5 p-4 rounded-xl border border-border hover:border-border-bright hover:bg-bg-surface transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary shrink-0">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[13px] font-semibold text-text-primary">Configure manually</span>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">Walk through each setting step by step</p>
          </button>
        </div>
      </form>
    </div>
  );
}
