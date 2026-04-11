import { useFormContext } from "react-hook-form";
import { Field } from "../../ui";
import { INPUT_CLS } from "../../types";
import type { SharedFormValues } from "../../types";

export function SecuritySection() {
  const { register } = useFormContext<SharedFormValues>();

  return (
    <div className="space-y-4">
      <Field label="Network policy">
        <select {...register("network_policy")} className={`${INPUT_CLS} cursor-pointer`}>
          <option value="none">Unrestricted</option>
          <option value="strict">Restricted (MITM proxy)</option>
          <option value="custom" disabled>
            Custom (coming soon)
          </option>
        </select>
      </Field>
    </div>
  );
}
