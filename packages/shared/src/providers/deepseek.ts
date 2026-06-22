import { claudeAdapter } from "./claude";
import type { ProviderAdapter, ContainerConfig } from "./types";
import { MODELS_BY_PROVIDER } from "./models";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

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
  models: MODELS_BY_PROVIDER.deepseek,
  authEnvKeys: ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"],
  getAuthEnv: getDeepSeekAuthEnv,
  bypassHosts: ["api.deepseek.com"],
  initContainerConfig(_opts?: { model?: string }): ContainerConfig {
    return { initScript: DEEPSEEK_INIT_SCRIPT, envVars: {} };
  },
};
