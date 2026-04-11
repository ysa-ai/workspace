import { useState, useEffect } from "react";
import { trpc } from "../../../../trpc";
import { useToast } from "../../../Toast";
import { Field } from "../../ui";
import { INPUT_CLS, INPUT_MONO_CLS, MODELS_BY_PROVIDER } from "../../types";

interface AiConfigEntry {
  id: string;
  provider: string;
  model: string;
  max_turns: number;
  allowed_tools: string;
  credential_name: string | null;
  is_default: boolean;
}

function newEntry(provider = "claude"): AiConfigEntry {
  const model = MODELS_BY_PROVIDER[provider]?.[0]?.id ?? "";
  return { id: crypto.randomUUID(), provider, model, max_turns: 60, allowed_tools: "", credential_name: null, is_default: false };
}

function serialize(entries: AiConfigEntry[]): string {
  return JSON.stringify(entries.map(({ id: _id, ...rest }) => rest));
}

export function AISettingsSection({ projectId }: { projectId: string }) {
  const showToast = useToast();
  const [configs, setConfigs] = useState<AiConfigEntry[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<AiConfigEntry>(() => newEntry());

  const { data: userSettings } = trpc.projects.getUserSettings.useQuery(
    { projectId },
    { refetchOnWindowFocus: false },
  );
  const { data: credData } = trpc.projects.listCredentials.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const credentials: { name: string; provider: string }[] = credData?.credentials ?? [];

  const updateMutation = trpc.projects.updateAiConfigs.useMutation({
    onError: (err) => showToast(err.message, "error"),
  });

  useEffect(() => {
    if (userSettings?.ai_configs) {
      try {
        const parsed = JSON.parse(userSettings.ai_configs);
        if (Array.isArray(parsed)) {
          setConfigs(parsed.map((c: any) => ({ ...c, id: crypto.randomUUID() })));
        }
      } catch {}
    }
  }, [userSettings?.ai_configs]);

  function save(next: AiConfigEntry[]) {
    setConfigs(next);
    updateMutation.mutate({ projectId, aiConfigs: serialize(next) });
  }

  function setDefault(id: string) {
    save(configs.map((c) => ({ ...c, is_default: c.id === id })));
  }

  function remove(id: string) {
    const next = configs.filter((c) => c.id !== id);
    if (next.length > 0 && !next.some((c) => c.is_default)) next[0].is_default = true;
    save(next);
  }

  function addEntry() {
    const entry = { ...draft, id: crypto.randomUUID() };
    const hasDefault = configs.some((c) => c.is_default);
    const next = [...configs, { ...entry, is_default: !hasDefault }];
    save(next);
    setAddOpen(false);
    setDraft(newEntry());
  }

  function updateDraftProvider(p: string) {
    const model = MODELS_BY_PROVIDER[p]?.[0]?.id ?? "";
    setDraft((d) => ({ ...d, provider: p, model }));
  }

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-bg-inset border border-border text-[12px] text-text-muted">
        AI configurations for this project. Credentials are stored{" "}
        <strong className="text-text-primary">only on your machine</strong> — we never see your API keys.
      </div>

      {configs.length === 0 && !addOpen && (
        <div className="p-4 rounded-lg border border-border bg-bg-surface text-[12px] text-text-muted">
          No AI configurations yet. Add one below.
        </div>
      )}

      {configs.length > 0 && (
        <div className="space-y-2">
          {configs.map((cfg) => (
            <ConfigRow
              key={cfg.id}
              cfg={cfg}
              credentials={credentials}
              isDefault={cfg.is_default}
              onSetDefault={() => setDefault(cfg.id)}
              onRemove={() => remove(cfg.id)}
              onChange={(updated) => save(configs.map((c) => (c.id === cfg.id ? { ...updated, id: cfg.id } : c)))}
            />
          ))}
        </div>
      )}

      {addOpen ? (
        <div className="p-4 rounded-lg border border-border bg-bg-surface space-y-3">
          <p className="text-[12px] font-medium text-text-primary">New AI configuration</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <select
                value={draft.provider}
                onChange={(e) => updateDraftProvider(e.target.value)}
                className={`${INPUT_CLS} cursor-pointer`}
              >
                <option value="claude">Claude Code</option>
                <option value="mistral">Mistral Vibe</option>
              </select>
            </Field>
            <Field label="Model">
              <select
                value={draft.model}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                className={`${INPUT_CLS} cursor-pointer`}
              >
                {(MODELS_BY_PROVIDER[draft.provider] ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max turns">
              <input
                type="number"
                value={draft.max_turns}
                onChange={(e) => setDraft((d) => ({ ...d, max_turns: parseInt(e.target.value) || 60 }))}
                className={INPUT_MONO_CLS}
                min={1}
              />
            </Field>
            <Field label="Credential">
              <select
                value={draft.credential_name ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, credential_name: e.target.value || null }))}
                className={`${INPUT_CLS} cursor-pointer`}
              >
                <option value="">— OAuth / env var —</option>
                {credentials.map((c) => (
                  <option key={c.name} value={c.name}>{c.name} ({c.provider})</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Allowed tools" hint="Comma-separated list, or empty for provider defaults">
            <input
              value={draft.allowed_tools}
              onChange={(e) => setDraft((d) => ({ ...d, allowed_tools: e.target.value }))}
              className={INPUT_MONO_CLS}
              placeholder="Read, Write, Bash, ..."
            />
          </Field>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setAddOpen(false); setDraft(newEntry()); }}
              className="px-3 py-1.5 text-[12px] text-text-muted hover:text-text-primary border border-border rounded-lg bg-bg-inset cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addEntry}
              className="px-3 py-1.5 text-[12px] font-medium bg-primary text-white rounded-lg hover:brightness-110 cursor-pointer transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-text-muted hover:text-text-primary border border-border rounded-lg bg-bg-inset cursor-pointer transition-colors"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add configuration
        </button>
      )}

      {credentials.length === 0 && (
        <div className="text-[11px] text-text-faint">
          No credentials found on this machine. Add one:{" "}
          <code className="font-mono bg-bg-inset px-1 rounded">ysa-agent credential add</code>
        </div>
      )}
    </div>
  );
}

function ConfigRow({
  cfg,
  credentials,
  isDefault,
  onSetDefault,
  onRemove,
  onChange,
}: {
  cfg: AiConfigEntry;
  credentials: { name: string; provider: string }[];
  isDefault: boolean;
  onSetDefault: () => void;
  onRemove: () => void;
  onChange: (updated: AiConfigEntry) => void;
}) {
  function updateProvider(p: string) {
    const model = MODELS_BY_PROVIDER[p]?.[0]?.id ?? "";
    onChange({ ...cfg, provider: p, model });
  }

  return (
    <div className={`p-3 rounded-lg border ${isDefault ? "border-primary/40 bg-primary/5" : "border-border bg-bg-surface"} space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isDefault ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">Default</span>
          ) : (
            <button
              type="button"
              onClick={onSetDefault}
              className="text-[11px] text-text-faint hover:text-primary cursor-pointer transition-colors"
            >
              Set default
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-text-faint hover:text-err cursor-pointer transition-colors"
          title="Remove"
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={cfg.provider}
          onChange={(e) => updateProvider(e.target.value)}
          className={`${INPUT_CLS} cursor-pointer text-[12px]`}
        >
          <option value="claude">Claude Code</option>
          <option value="mistral">Mistral Vibe</option>
        </select>
        <select
          value={cfg.model}
          onChange={(e) => onChange({ ...cfg, model: e.target.value })}
          className={`${INPUT_CLS} cursor-pointer text-[12px]`}
        >
          {(MODELS_BY_PROVIDER[cfg.provider] ?? []).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[11px] text-text-muted mb-1">Max turns</p>
          <input
            type="number"
            value={cfg.max_turns}
            onChange={(e) => onChange({ ...cfg, max_turns: parseInt(e.target.value) || 60 })}
            className={`${INPUT_MONO_CLS} text-[12px]`}
            min={1}
          />
        </div>
        <div>
          <p className="text-[11px] text-text-muted mb-1">Credential</p>
          <select
            value={cfg.credential_name ?? ""}
            onChange={(e) => onChange({ ...cfg, credential_name: e.target.value || null })}
            className={`${INPUT_CLS} cursor-pointer text-[12px]`}
          >
            <option value="">— OAuth / env var —</option>
            {credentials.map((c) => (
              <option key={c.name} value={c.name}>{c.name} ({c.provider})</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <p className="text-[11px] text-text-muted mb-1">Allowed tools</p>
        <input
          value={cfg.allowed_tools}
          onChange={(e) => onChange({ ...cfg, allowed_tools: e.target.value })}
          className={`${INPUT_MONO_CLS} text-[12px]`}
          placeholder="Read, Write, Bash, ... (empty = provider defaults)"
        />
      </div>
    </div>
  );
}
