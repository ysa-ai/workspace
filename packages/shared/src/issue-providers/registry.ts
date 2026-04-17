import type { IssueProviderAdapter } from "./types";
import { gitlabAdapter } from "./gitlab";
import { githubAdapter } from "./github";

const registry = new Map<string, IssueProviderAdapter>([
  ["gitlab", gitlabAdapter],
  ["github", githubAdapter],
]);

export function getIssueProvider(id: string): IssueProviderAdapter {
  const adapter = registry.get(id);
  if (!adapter) throw new Error(`Unknown issue provider: ${id}`);
  return adapter;
}

export function registerIssueProvider(adapter: IssueProviderAdapter): void {
  registry.set(adapter.id, adapter);
}
