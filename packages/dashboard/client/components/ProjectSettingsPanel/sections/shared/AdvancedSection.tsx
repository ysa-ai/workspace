import { useState } from "react";
import { useFormContext, useFieldArray } from "react-hook-form";
import { trpc } from "../../../../trpc";
import { useToast } from "../../../Toast";
import { Field } from "../../ui";
import { INPUT_BASE } from "../../types";
import type { SharedFormValues } from "../../types";

export function AdvancedSection({ projectRoot }: { projectRoot: string }) {
  const { register } = useFormContext<SharedFormValues>();
  const { fields, append, remove, update } = useFieldArray<SharedFormValues, "worktree_files">({
    name: "worktree_files",
  });
  const [pickingField, setPickingField] = useState(false);
  const showToast = useToast();

  const pickFileOrFolderMutation = trpc.projects.pickFileOrFolder.useMutation();
  const browseWorktreeFile = () => {
    setPickingField(true);
    pickFileOrFolderMutation.mutate(undefined, {
      onSuccess: (data) => {
        if (data.path) {
          const root = projectRoot?.replace(/\/+$/, "");
          const relative =
            root && data.path.startsWith(root + "/") ? data.path.slice(root.length + 1) : data.path;
          append({ value: relative });
        }
        setPickingField(false);
      },
      onError: (err) => {
        showToast(err.message, "error");
        setPickingField(false);
      },
    });
  };

  return (
    <div className="space-y-4">
      <Field
        label="Worktree files"
        hint="Files or folders copied from the project root into each worktree before the agent starts. Useful for local config or state not committed to git."
      >
        <div className="space-y-1.5">
          {fields.map((field, idx) => (
            <div key={field.id} className="flex gap-2 items-center">
              <input
                {...register(`worktree_files.${idx}.value`)}
                className={`${INPUT_BASE} flex-1 min-w-0 font-mono`}
                placeholder=".ysa"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                className="shrink-0 p-1.5 rounded-md text-text-faint hover:text-err hover:bg-err-bg transition-colors cursor-pointer"
                title="Remove"
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={browseWorktreeFile}
            disabled={pickingField}
            className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {pickingField ? "Browsing…" : "Add"}
          </button>
        </div>
      </Field>
    </div>
  );
}
