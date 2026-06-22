import type { ProviderModel } from "./types";

// Pure data — no runtime imports — so it is safe to bundle into the browser.
// Single source of truth for both the server provider adapters and the client UI.
export const MODELS_BY_PROVIDER: Record<string, ProviderModel[]> = {
  claude: [
    { id: "claude-opus-4-8", name: "Opus 4.8", isDefault: false },
    { id: "claude-opus-4-7", name: "Opus 4.7", isDefault: false },
    { id: "claude-opus-4-6", name: "Opus 4.6", isDefault: false },
    { id: "claude-sonnet-4-6", name: "Sonnet 4.6", isDefault: true },
    { id: "claude-sonnet-4-5", name: "Sonnet 4.5", isDefault: false },
    { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", isDefault: false },
    { id: "claude-fable-5", name: "Fable 5", isDefault: false },
  ],
  mistral: [
    { id: "devstral-2", name: "Devstral 2", isDefault: true },
    { id: "mistral-large-latest", name: "Mistral Large 3", isDefault: false },
    { id: "mistral-medium-latest", name: "Mistral Medium 3.1", isDefault: false },
    { id: "devstral-small-latest", name: "Devstral Small", isDefault: false },
    { id: "codestral-latest", name: "Codestral", isDefault: false },
  ],
  deepseek: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", isDefault: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", isDefault: false },
  ],
};
