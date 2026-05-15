// APT packages required by each workflow module — mirrors MODULE_APT_PACKAGES in packages/agent.
const MODULE_APT_PACKAGES: Record<string, string[]> = {
  frontend_debug: ["chromium"],
};

// Global packages required by each workflow module — format: "<manager>:<package>".
// Mirrors MODULE_GLOBAL_PACKAGES in packages/agent.
const MODULE_GLOBAL_PACKAGES: Record<string, string[]> = {
  frontend_debug: ["bun:playwright-core"],
};

export function aptPackagesForModules(moduleNames: string[]): string[] {
  return [...new Set(moduleNames.flatMap((name) => MODULE_APT_PACKAGES[name] ?? []))];
}

export function globalPackagesForModules(moduleNames: string[]): string[] {
  return [...new Set(moduleNames.flatMap((name) => MODULE_GLOBAL_PACKAGES[name] ?? []))];
}
