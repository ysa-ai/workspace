import { useForm, useFieldArray } from "react-hook-form";
import { WizardField, INPUT, INPUT_MONO, AdvancedSection, StepFooter, confidence } from "../ui";
import type { WizardMode, DetectedConfig } from "../index";

interface DevServerEntry { name: string; cmd: string; port: string; env: string; }

interface Step3Values {
  languages: string[];
  install_cmd: string;
  build_cmd: string;
  test_cmd: string;
  pre_dev_cmd: string;
  deps_cache_files: string;
  dev_servers: DevServerEntry[];
}

const ALL_LANGUAGES: [string, string][] = [
  ["node", "Node.js"], ["python", "Python"], ["go", "Go"], ["rust", "Rust"],
  ["ruby", "Ruby"], ["php", "PHP"], ["java-maven", "Java (Maven)"], ["java-gradle", "Java (Gradle)"],
  ["dotnet", ".NET"], ["c-cpp", "C/C++"], ["elixir", "Elixir"],
];

export function Step3Stack({
  mode,
  detected,
  onNext,
  onSkip,
  onBack,
}: {
  mode: WizardMode;
  detected: DetectedConfig | null;
  onNext: (data: Step3Values) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const defaultDevServers = (detected?.devServers ?? []).map((s) => ({
    name: s.name, cmd: s.command, port: String(s.port || 3000), env: "",
  }));

  const { register, handleSubmit, watch, setValue, control } = useForm<Step3Values>({
    defaultValues: {
      languages: detected?.languageRuntimes ?? [],
      install_cmd: detected?.installCommand ?? "",
      build_cmd: detected?.buildCommand ?? "",
      test_cmd: detected?.testCommand ?? "",
      pre_dev_cmd: detected?.preDevCommand ?? "",
      deps_cache_files: (detected?.depsCacheFiles ?? []).join("\n"),
      dev_servers: defaultDevServers,
    },
  });

  const { fields: devServerFields, append: appendDevServer, remove: removeDevServer } =
    useFieldArray({ control, name: "dev_servers" });

  const languages = watch("languages");

  const toggleLanguage = (id: string) => {
    const next = languages.includes(id) ? languages.filter((l) => l !== id) : [...languages, id];
    setValue("languages", next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Stack & commands</h3>
        <p className="text-[13px] text-text-muted">What does your project need to run? The agent will set this up inside its sandbox.</p>
      </div>

      <div className="space-y-4">
        <WizardField
          label="Language runtimes"
          hint="Pre-installs runtimes before the agent runs"
          confidence={confidence(detected, "languageRuntimes")}
        >
          <div className="flex flex-wrap gap-1.5">
            {ALL_LANGUAGES.map(([id, label]) => {
              const active = languages.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleLanguage(id)}
                  className={`px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors cursor-pointer ${
                    active ? "bg-primary/10 border-primary/40 text-primary" : "bg-bg-inset border-border text-text-muted hover:text-text-primary hover:border-border-bright"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </WizardField>

        <WizardField label="Install command" hint="e.g. bun install" confidence={confidence(detected, "installCommand")}>
          <input {...register("install_cmd")} className={INPUT_MONO} placeholder="bun install" />
        </WizardField>

        <WizardField label="Build command" hint="e.g. bun run build" confidence={confidence(detected, "buildCommand")}>
          <input {...register("build_cmd")} className={INPUT_MONO} placeholder="bun run build" />
        </WizardField>

        <DevServersField
          register={register}
          fields={devServerFields}
          append={appendDevServer}
          remove={removeDevServer}
          confidence={confidence(detected, "devServers")}
        />

        <AdvancedSection>
          <WizardField label="Test command" hint="Used in execute phase for verification" confidence={confidence(detected, "testCommand")}>
            <input {...register("test_cmd")} className={INPUT_MONO} placeholder="bun test" />
          </WizardField>
          <WizardField label="Pre-dev command" hint="Run before dev servers, e.g. bun run build --filter=ui" confidence={confidence(detected, "preDevCommand")}>
            <input {...register("pre_dev_cmd")} className={INPUT_MONO} placeholder="bun run build --filter=ui" />
          </WizardField>
          <WizardField label="Dependency cache files" hint="One per line, relative to project root" confidence={confidence(detected, "depsCacheFiles")}>
            <textarea
              {...register("deps_cache_files")}
              className={`${INPUT_MONO} resize-none text-[11px]`}
              rows={3}
              placeholder={"package.json\nbun.lockb"}
            />
          </WizardField>
        </AdvancedSection>
      </div>

      <StepFooter onBack={onBack} onSkip={onSkip} onNext={handleSubmit(onNext)} />
    </div>
  );
}

function DevServersField({ register, fields, append, remove, confidence: conf }: any) {
  return (
    <WizardField label="Dev servers" hint="Servers the agent can start for testing" confidence={conf}>
      <div className="space-y-2">
        {fields.map((field: any, idx: number) => (
          <div key={field.id} className="border border-border rounded-lg p-3 space-y-2 bg-bg-inset">
            <div className="flex gap-2 items-center">
              <input {...register(`dev_servers.${idx}.name`)} className={`${INPUT} flex-1 min-w-0`} placeholder="Name (e.g. API)" />
              <input type="number" {...register(`dev_servers.${idx}.port`)} className="bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all w-24 shrink-0 font-mono" placeholder="3000" />
              <button type="button" onClick={() => remove(idx)} className="shrink-0 p-1.5 rounded-md text-text-faint hover:text-err transition-colors cursor-pointer">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <input {...register(`dev_servers.${idx}.cmd`)} className={INPUT_MONO} placeholder="Command (e.g. bun dev)" />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => append({ name: "", cmd: "", port: "3000", env: "" })}
        className="mt-2 flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14" /></svg>
        Add server
      </button>
    </WizardField>
  );
}
