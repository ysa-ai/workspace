import { useFormContext } from "react-hook-form";
import { Field } from "../../ui";
import { INPUT_MONO_CLS } from "../../types";
import type { UserFormValues } from "../../types";

export function ContainerSection() {
  const { register } = useFormContext<UserFormValues>();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Memory limit">
          <input {...register("container_memory")} className={INPUT_MONO_CLS} placeholder="4g" />
        </Field>
        <Field label="CPU limit">
          <input
            type="number"
            {...register("container_cpus", { valueAsNumber: true })}
            className={INPUT_MONO_CLS}
            min={1}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="PID limit">
          <input
            type="number"
            {...register("container_pids_limit", { valueAsNumber: true })}
            className={INPUT_MONO_CLS}
            min={64}
          />
        </Field>
        <Field label="Timeout (seconds)">
          <input
            type="number"
            {...register("container_timeout", { valueAsNumber: true })}
            className={INPUT_MONO_CLS}
            min={60}
          />
        </Field>
      </div>
    </div>
  );
}
