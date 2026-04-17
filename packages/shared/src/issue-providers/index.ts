export type { IssueProviderAdapter, IssueProviderAction, HttpMethod } from "./types";
export { gitlabAdapter } from "./gitlab";
export { githubAdapter } from "./github";
export { getIssueProvider, registerIssueProvider } from "./registry";
