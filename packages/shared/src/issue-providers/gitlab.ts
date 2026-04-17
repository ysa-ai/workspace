import type { IssueProviderAdapter } from "./types";

export const gitlabAdapter: IssueProviderAdapter = {
  id: "gitlab",
  authHeader: "Private-Token",

  baseUrl(instanceUrl: string): string {
    try {
      const url = new URL(instanceUrl);
      return `${url.protocol}//${url.host}/api/v4`;
    } catch {
      return `${instanceUrl}/api/v4`;
    }
  },

  projectId(issueUrlTemplate: string): string {
    try {
      const url = new URL(issueUrlTemplate.replace("{id}", "0"));
      const projectPath = url.pathname.split("/-/")[0]?.replace(/^\//, "") ?? "";
      return encodeURIComponent(projectPath);
    } catch {
      return "";
    }
  },

  issueIid(_issueUrlTemplate: string, issueId: string): string {
    return issueId;
  },

  actions: {
    get_issue:      { method: "GET",   path: "/projects/{project_id}/issues/{issue_iid}" },
    list_comments:  { method: "GET",   path: "/projects/{project_id}/issues/{issue_iid}/notes" },
    create_comment: { method: "POST",  path: "/projects/{project_id}/issues/{issue_iid}/notes" },
    update_issue:   { method: "PUT",   path: "/projects/{project_id}/issues/{issue_iid}" },
    create_mr:      { method: "POST",  path: "/projects/{project_id}/merge_requests" },
    list_mrs:       { method: "GET",   path: "/projects/{project_id}/merge_requests" },
  },
};
