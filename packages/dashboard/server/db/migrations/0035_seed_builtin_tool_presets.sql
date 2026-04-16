INSERT INTO tool_presets (name, description, tools, org_id, is_builtin) VALUES
(
  'readonly',
  'Read files, search code, web browsing, git log/diff — no editing or pushing.',
  'Read,Write,Glob,Grep,WebSearch,WebFetch,Bash(git log *),Bash(git diff *),Bash(git show *),Bash(ls *),Bash(find *),Bash(wc *),Bash(curl *),mcp__gitlab__get_issue,mcp__gitlab__list_issue_discussions,mcp__gitlab__download_attachment,mcp__github__get_issue,mcp__github__list_issue_comments,mcp__github__download_attachment',
  NULL,
  true
),
(
  'readwrite',
  'Full access: edit files, run bash commands, push code, create MRs.',
  'Read,Edit,Write,Glob,Grep,WebSearch,WebFetch,Bash,mcp__gitlab__get_issue,mcp__gitlab__get_project,mcp__gitlab__get_file_contents,mcp__gitlab__list_issue_discussions,mcp__gitlab__update_issue,mcp__gitlab__create_merge_request,mcp__gitlab__create_branch,mcp__gitlab__push_files,mcp__gitlab__create_or_update_file,mcp__gitlab__download_attachment,mcp__github__get_issue,mcp__github__get_file_contents,mcp__github__list_issue_comments,mcp__github__update_issue,mcp__github__create_pull_request,mcp__github__create_branch,mcp__github__push_files,mcp__github__create_or_update_file,mcp__github__create_issue_comment,mcp__github__download_attachment',
  NULL,
  true
),
(
  'post-execution',
  'Read-only + issue/MR management (update ticket, post comments, remove worktree). Use for wrap-up steps after code is already pushed.',
  'Read,Write,Glob,Grep,Bash(git worktree remove *),Bash(git worktree list),Bash(curl *),mcp__gitlab__update_issue,mcp__gitlab__create_note,mcp__gitlab__list_merge_requests,mcp__gitlab__get_issue,mcp__github__update_issue,mcp__github__create_issue_comment,mcp__github__list_pull_requests,mcp__github__get_issue',
  NULL,
  true
)
ON CONFLICT (name) DO NOTHING;
