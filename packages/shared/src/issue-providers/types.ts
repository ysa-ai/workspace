export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface IssueProviderAction {
  method: HttpMethod;
  path: string;
}

export interface IssueProviderAdapter {
  id: string;
  authHeader: string;
  baseUrl(instanceUrl: string): string;
  projectId(issueUrlTemplate: string): string;
  issueIid(issueUrlTemplate: string, issueId: string): string;
  actions: Record<string, IssueProviderAction>;
}
