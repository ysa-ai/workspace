import { claudeAdapter } from "./claude";
import type { ProviderAdapter, ProviderModel, ContainerConfig } from "./types";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

const DEEPSEEK_MODELS: ProviderModel[] = [
  { id: "deepseek-v4-pro",   name: "DeepSeek V4 Pro",   isDefault: true },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash",  isDefault: false },
];

async function getDeepSeekAuthEnv(): Promise<Record<string, string>> {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) throw new Error("ANTHROPIC_AUTH_TOKEN is not set for DeepSeek.");
  return {
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_BASE_URL: DEEPSEEK_BASE_URL,
  };
}

const DEEPSEEK_INIT_SCRIPT = claudeAdapter.initContainerConfig().initScript + `
export ANTHROPIC_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash`;

export const deepseekAdapter: ProviderAdapter = {
  ...claudeAdapter,
  id: "deepseek",
  name: "DeepSeek",
  models: DEEPSEEK_MODELS,
  authEnvKeys: ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"],
  getAuthEnv: getDeepSeekAuthEnv,
  bypassHosts: ["api.deepseek.com"],
  initContainerConfig(_opts?: { model?: string }): ContainerConfig {
    return { initScript: DEEPSEEK_INIT_SCRIPT, envVars: {} };
  },
};
