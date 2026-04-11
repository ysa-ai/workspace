export function buildAllowedToolsFromPreset(
  preset: string,
  allowlist: string[] | null,
  issueSource: "gitlab" | "github" = "gitlab",
): string {
  if (allowlist && allowlist.length > 0) return allowlist.join(",");
  const gh = issueSource === "github";
  switch (preset) {
    case "readonly":
      return gh
        ? "Read,Write,Glob,Grep,WebSearch,WebFetch,Bash(git log *),Bash(git diff *),Bash(git show *),Bash(ls *),Bash(find *),Bash(wc *),Bash(curl *),mcp__github__get_issue,mcp__github__list_issue_comments,mcp__github__download_attachment"
        : "Read,Write,Glob,Grep,WebSearch,WebFetch,Bash(git log *),Bash(git diff *),Bash(git show *),Bash(ls *),Bash(find *),Bash(wc *),Bash(curl *),mcp__gitlab__get_issue,mcp__gitlab__list_issue_discussions,mcp__gitlab__download_attachment";
    case "readwrite":
      return gh
        ? "Read,Edit,Write,Glob,Grep,WebSearch,WebFetch,Bash,mcp__github__get_issue,mcp__github__get_file_contents,mcp__github__list_issue_comments,mcp__github__update_issue,mcp__github__create_pull_request,mcp__github__create_branch,mcp__github__push_files,mcp__github__create_or_update_file,mcp__github__create_issue_comment,mcp__github__download_attachment"
        : "Read,Edit,Write,Glob,Grep,WebSearch,WebFetch,Bash,mcp__gitlab__get_issue,mcp__gitlab__get_project,mcp__gitlab__get_file_contents,mcp__gitlab__list_issue_discussions,mcp__gitlab__update_issue,mcp__gitlab__create_merge_request,mcp__gitlab__create_branch,mcp__gitlab__push_files,mcp__gitlab__create_or_update_file,mcp__gitlab__download_attachment";
    case "post-execution":
      return gh
        ? "Read,Write,Glob,Grep,Bash(git worktree remove *),Bash(git worktree list),Bash(curl *),mcp__github__update_issue,mcp__github__create_issue_comment,mcp__github__list_pull_requests,mcp__github__get_issue"
        : "Read,Write,Glob,Grep,Bash(git worktree remove *),Bash(git worktree list),Bash(curl *),mcp__gitlab__update_issue,mcp__gitlab__create_note,mcp__gitlab__list_merge_requests,mcp__gitlab__get_issue";
    default:
      return "Read,Glob,Grep";
  }
}
