import { useFormContext } from "react-hook-form";
import { Field } from "../../ui";
import { INPUT_CLS, INPUT_MONO_CLS } from "../../types";
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
      <Field
        label="Bypass hosts"
        hint="Hosts that bypass all network filtering — direct TCP access via host network (VPN-accessible). One entry per line, optionally with port: host or host:port."
      >
        <textarea
          {...register("bypass_hosts")}
          className={`${INPUT_MONO_CLS} resize-none`}
          rows={4}
          placeholder={"mongodb.example.com:27017\nredis.internal"}
        />
      </Field>
    </div>
  );
}
