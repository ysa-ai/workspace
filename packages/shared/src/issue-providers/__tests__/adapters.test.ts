import { describe, test, expect } from "bun:test";
import { gitlabAdapter } from "../gitlab";
import { githubAdapter } from "../github";
import { getIssueProvider } from "../registry";

describe("gitlabAdapter.baseUrl", () => {
  test("extracts host and appends /api/v4", () => {
    expect(gitlabAdapter.baseUrl("https://gitlab.com/group/repo/-/issues/1")).toBe("https://gitlab.com/api/v4");
  });

  test("works with self-hosted instance", () => {
    expect(gitlabAdapter.baseUrl("https://code.example.com/group/repo/-/issues/{id}")).toBe("https://code.example.com/api/v4");
  });
});

describe("gitlabAdapter.projectId", () => {
  test("URL-encodes project path from issue URL template", () => {
    expect(gitlabAdapter.projectId("https://gitlab.com/mygroup/myrepo/-/issues/{id}")).toBe("mygroup%2Fmyrepo");
  });

  test("handles nested group paths", () => {
    expect(gitlabAdapter.projectId("https://gitlab.com/a/b/c/-/issues/{id}")).toBe("a%2Fb%2Fc");
  });

  test("handles self-hosted URL", () => {
    expect(gitlabAdapter.projectId("https://code.example.com/group/project/-/issues/{id}")).toBe("group%2Fproject");
  });
});

describe("gitlabAdapter.issueIid", () => {
  test("returns taskId as-is", () => {
    expect(gitlabAdapter.issueIid("https://gitlab.com/g/r/-/issues/{id}", "42")).toBe("42");
  });
});

describe("githubAdapter.baseUrl", () => {
  test("always returns api.github.com", () => {
    expect(githubAdapter.baseUrl("https://github.com/owner/repo/issues/1")).toBe("https://api.github.com");
    expect(githubAdapter.baseUrl("https://github.com/other/repo/issues/{id}")).toBe("https://api.github.com");
  });
});

describe("githubAdapter.projectId", () => {
  test("extracts owner/repo from issue URL template", () => {
    expect(githubAdapter.projectId("https://github.com/myorg/myrepo/issues/{id}")).toBe("myorg/myrepo");
  });

  test("handles different owners and repos", () => {
    expect(githubAdapter.projectId("https://github.com/anthropics/claude-code/issues/123")).toBe("anthropics/claude-code");
  });
});

describe("githubAdapter.issueIid", () => {
  test("returns taskId as-is", () => {
    expect(githubAdapter.issueIid("https://github.com/o/r/issues/{id}", "99")).toBe("99");
  });
});

describe("getIssueProvider", () => {
  test("returns gitlab adapter", () => {
    expect(getIssueProvider("gitlab").id).toBe("gitlab");
  });

  test("returns github adapter", () => {
    expect(getIssueProvider("github").id).toBe("github");
  });

  test("throws for unknown provider", () => {
    expect(() => getIssueProvider("linear")).toThrow("Unknown issue provider: linear");
  });
});
