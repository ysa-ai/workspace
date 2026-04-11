import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { trpc } from "../../../../trpc";
import { useToast } from "../../../Toast";
import { Field, BrowseBtn } from "../../ui";
import { INPUT_BASE } from "../../types";
import type { UserFormValues } from "../../types";

export function PathsSection() {
  const { register, watch, setValue } = useFormContext<UserFormValues>();
  const projectRoot = watch("project_root");
  const [pickingField, setPickingField] = useState<string | null>(null);
  const showToast = useToast();

  const pickDirectoryMutation = trpc.projects.pickDirectory.useMutation();
  const browseDir = (field: keyof UserFormValues) => {
    setPickingField(field);
    pickDirectoryMutation.mutate(undefined, {
      onSuccess: (data) => {
        if (data.path) setValue(field, data.path, { shouldDirty: true });
        setPickingField(null);
      },
      onError: (err) => {
        showToast(err.message, "error");
        setPickingField(null);
      },
    });
  };

  const pickFileMutation = trpc.projects.pickFile.useMutation();
  const browseFile = (field: keyof UserFormValues, prompt: string, append = false) => {
    setPickingField(field);
    pickFileMutation.mutate(
      { prompt },
      {
        onSuccess: (data) => {
          if (data.path) {
            if (append) {
              const current = watch(field) as string;
              const next = current ? `${current},${data.path}` : data.path!;
              setValue(field, next, { shouldDirty: true });
            } else {
              setValue(field, data.path, { shouldDirty: true });
            }
          }
          setPickingField(null);
        },
        onError: (err) => {
          showToast(err.message, "error");
          setPickingField(null);
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-bg-inset border border-border text-[12px] text-text-muted">
        These settings are <strong className="text-text-primary">only visible to you</strong> — local filesystem paths
        specific to your machine. Other org members cannot see them.
      </div>
      {!projectRoot && (
        <div className="p-3 rounded-lg bg-warn-bg border border-warn/30 text-[12px] text-warn">
          Project root is not set. The agent cannot run issues for this project until you configure it here.
        </div>
      )}
      <Field label="Project root" hint="Absolute path to the repository on your machine">
        <div className="flex gap-2">
          <input
            {...register("project_root")}
            className={`${INPUT_BASE} flex-1 min-w-0 font-mono`}
            placeholder="/path/to/repo"
          />
          <BrowseBtn
            onClick={() => browseDir("project_root")}
            loading={pickingField === "project_root"}
            disabled={pickingField !== null}
          />
        </div>
      </Field>
      <Field label="Worktree prefix" hint="Leave empty to auto-derive from project root">
        <div className="flex gap-2">
          <input
            {...register("worktree_prefix")}
            className={`${INPUT_BASE} flex-1 min-w-0 font-mono`}
            placeholder="/path/to/repo/.ysa/worktrees/"
          />
          <BrowseBtn
            onClick={() => browseDir("worktree_prefix")}
            loading={pickingField === "worktree_prefix"}
            disabled={pickingField !== null}
          />
        </div>
      </Field>
      <Field
        label="MCP config"
        hint="Path to .mcp.json on your machine. Press ⌘⇧. in the picker to show hidden files."
      >
        <div className="flex gap-2">
          <input
            {...register("mcp_config")}
            className={`${INPUT_BASE} flex-1 min-w-0 font-mono`}
            placeholder="/path/to/project/.mcp.json"
          />
          <BrowseBtn
            onClick={() => browseFile("mcp_config", "Select MCP config file")}
            loading={pickingField === "mcp_config"}
            disabled={pickingField !== null}
          />
        </div>
      </Field>
      <Field
        label="Env files"
        hint="Comma-separated paths to .env files on your machine. Press ⌘⇧. in the picker to show hidden files."
      >
        <div className="flex gap-2">
          <input
            {...register("env_vars")}
            className={`${INPUT_BASE} flex-1 min-w-0 font-mono`}
            placeholder="apps/api/.env,apps/web/.env"
          />
          <BrowseBtn
            onClick={() => browseFile("env_vars", "Select .env file", true)}
            loading={pickingField === "env_vars"}
            disabled={pickingField !== null}
          />
        </div>
      </Field>
      <Field label="npmrc path" hint="Path to .npmrc with private registry credentials on your machine.">
        <div className="flex gap-2">
          <input
            {...register("npmrc_path")}
            className={`${INPUT_BASE} flex-1 min-w-0 font-mono`}
            placeholder="~/.npmrc"
          />
          <BrowseBtn
            onClick={() => browseFile("npmrc_path", "Select .npmrc file")}
            loading={pickingField === "npmrc_path"}
            disabled={pickingField !== null}
          />
        </div>
      </Field>
    </div>
  );
}
