import { useEffect, useRef } from "react";
import { useFormContext, useFieldArray } from "react-hook-form";
import { trpc } from "../../../../trpc";
import { Field } from "../../ui";
import { BuildProgress } from "../../../BuildProgress";
import { INPUT_BASE, INPUT_CLS, INPUT_MONO_CLS } from "../../types";
import type { SharedFormValues } from "../../types";

export function BuildSection({ projectId, showBuild, onBuildDone }: { projectId?: string; showBuild?: boolean; onBuildDone?: () => void }) {
  const { register, watch, setValue } = useFormContext<SharedFormValues>();

  const { data: buildState } = trpc.system.buildStatus.useQuery(
    { projectId: projectId! },
    {
      enabled: !!projectId && !!showBuild,
      refetchInterval: (query) => {
        const s = (query.state.data as { status: string } | undefined)?.status;
        return s === "building" ? 500 : false;
      },
    },
  );

  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!buildState) return;
    const prev = prevStatus.current;
    prevStatus.current = buildState.status;
    if (prev === "building" && (buildState.status === "done" || buildState.status === "error")) {
      onBuildDone?.();
    }
  }, [buildState?.status]);
  const languages = watch("languages");
  const { fields: devServerFields, append: appendDevServer, remove: removeDevServer } =
    useFieldArray<SharedFormValues, "dev_servers">({ name: "dev_servers" });

  const toggleLanguage = (id: string) => {
    const next = languages.includes(id) ? languages.filter((l) => l !== id) : [...languages, id];
    setValue("languages", next, { shouldDirty: true });
  };

  return (
    <div className="space-y-4">
      <Field label="Install command" hint="Run in worktree after creation, e.g. bun install">
        <input {...register("install_cmd")} className={INPUT_MONO_CLS} placeholder="bun install" />
      </Field>
      <Field label="Build command" hint="Run after install, e.g. bun run build">
        <input {...register("build_cmd")} className={INPUT_MONO_CLS} placeholder="bun run build" />
      </Field>
      <Field
        label="Pre-dev command"
        hint="Run before dev servers are launched, and during worktree init. Optional — use for rebuilding workspace packages before running, e.g. bun run build --filter=ui"
      >
        <input
          {...register("pre_dev_cmd")}
          className={INPUT_MONO_CLS}
          placeholder="bun run build --filter=ui --filter=utils"
        />
      </Field>
      <Field label="Test command" hint="Used in execute phase for verification">
        <input {...register("test_cmd")} className={INPUT_MONO_CLS} placeholder="bun run test" />
      </Field>
      <Field
        label="Dependency cache files"
        hint="Files used to detect dependency changes and invalidate the deps cache. Auto-detected from language runtimes. Add extra paths for monorepos or edge cases (one per line, relative to project root)."
      >
        <textarea
          {...register("deps_cache_files")}
          className={`w-full bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all font-mono resize-none text-[11px]`}
          placeholder={"apps/api/package.json\nservices/worker/requirements.txt"}
          rows={3}
        />
      </Field>
      <Field
        label="Language runtimes"
        hint="Pre-installs language runtimes before the agent runs. APK-based languages (Ruby, PHP, Java, C/C++, Elixir) build a per-project image; mise-based languages use a per-project volume."
      >
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["node", "Node.js"],
              ["python", "Python"],
              ["go", "Go"],
              ["rust", "Rust"],
              ["ruby", "Ruby"],
              ["php", "PHP"],
              ["java-maven", "Java (Maven)"],
              ["java-gradle", "Java (Gradle)"],
              ["dotnet", ".NET"],
              ["c-cpp", "C/C++"],
              ["elixir", "Elixir"],
            ] as [string, string][]
          ).map(([id, label]) => {
            const active = languages.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleLanguage(id)}
                className={`px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors cursor-pointer ${
                  active
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "bg-bg-inset border-border text-text-muted hover:text-text-primary hover:border-border-bright"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Field>
      {showBuild && buildState && (buildState.status === "building" || buildState.status === "done" || buildState.status === "error") && (
        <div className="pt-1">
          <BuildProgress step={buildState.step ?? ""} progress={buildState.progress ?? 0} status={buildState.status} />
        </div>
      )}
      <div>
        <label className="block text-[13px] font-semibold mb-2">Dev servers</label>
        <div className="space-y-2">
          {devServerFields.map((field, idx) => (
            <div key={field.id} className="border border-border rounded-lg p-3 space-y-2 bg-bg-inset">
              <div className="flex gap-2 items-center">
                <input
                  {...register(`dev_servers.${idx}.name`)}
                  className={`${INPUT_BASE} flex-1 min-w-0`}
                  placeholder="Name (e.g. API)"
                />
                <input
                  type="number"
                  {...register(`dev_servers.${idx}.port`)}
                  className={`${INPUT_BASE} w-24 shrink-0 font-mono`}
                  placeholder="3000"
                  min={1}
                />
                <button
                  type="button"
                  onClick={() => removeDevServer(idx)}
                  className="shrink-0 p-1.5 rounded-md text-text-faint hover:text-err hover:bg-err-bg transition-colors cursor-pointer"
                  title="Remove"
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <input
                {...register(`dev_servers.${idx}.cmd`)}
                className={INPUT_MONO_CLS}
                placeholder="Command (e.g. bun dev)"
              />
              <DevServerEnvField idx={idx} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => appendDevServer({ name: "", cmd: "", port: "3000", env: "" })}
          className="mt-2 flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14m-7-7h14" />
          </svg>
          Add server
        </button>
      </div>
    </div>
  );
}

function DevServerEnvField({ idx }: { idx: number }) {
  const { register, watch } = useFormContext<SharedFormValues>();
  const env = watch(`dev_servers.${idx}.env`);
  return (
    <textarea
      {...register(`dev_servers.${idx}.env`)}
      className={`w-full bg-bg-inset border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all font-mono resize-none text-[11px]`}
      placeholder={"Env vars (optional)\nKEY=value"}
      rows={env ? env.split("\n").length + 1 : 2}
    />
  );
}
