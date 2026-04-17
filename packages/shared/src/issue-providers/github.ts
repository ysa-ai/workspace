import type { IssueProviderAdapter } from "./types";

export const githubAdapter: IssueProviderAdapter = {
  id: "github",
  authHeader: "Authorization: Bearer",

  baseUrl(_instanceUrl: string): string {
    return "https://api.github.com";
  },

  projectId(issueUrlTemplate: string): string {
    try {
      const url = new URL(issueUrlTemplate.replace("{id}", "0"));
      const parts = url.pathname.split("/").filter(Boolean);
      return `${parts[0]}/${parts[1]}`;
    } catch {
      return "";
    }
  },

  issueIid(_issueUrlTemplate: string, issueId: string): string {
    return issueId;
  },

  actions: {
    get_issue:      { method: "GET",   path: "/repos/{project_id}/issues/{issue_iid}" },
    list_comments:  { method: "GET",   path: "/repos/{project_id}/issues/{issue_iid}/comments" },
    create_comment: { method: "POST",  path: "/repos/{project_id}/issues/{issue_iid}/comments" },
    update_issue:   { method: "PATCH", path: "/repos/{project_id}/issues/{issue_iid}" },
    create_mr:      { method: "POST",  path: "/repos/{project_id}/pulls" },
    list_mrs:       { method: "GET",   path: "/repos/{project_id}/pulls" },
  },
};
