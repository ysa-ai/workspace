ALTER TABLE user_project_settings ADD COLUMN IF NOT EXISTS code_repo_token text;

-- Update builtin tool presets to use provider-agnostic capability names
UPDATE tool_presets SET
  tools = 'fs_read,Write,web,git_read,bash_readonly,bash_http,issue_read',
  description = 'Read files, search code, web browsing, git log/diff — no editing or pushing.'
WHERE name = 'readonly' AND is_builtin = true;

UPDATE tool_presets SET
  tools = 'fs_read,fs_write,web,bash_full,git_read,git_push,git_branch,issue_read,issue_write,mr_create,comment_write',
  description = 'Full access: edit files, run bash commands, push code, create MRs.'
WHERE name = 'readwrite' AND is_builtin = true;

UPDATE tool_presets SET
  tools = 'fs_read,Write,bash_http,git_worktree,issue_read,issue_write,mr_read,comment_write',
  description = 'Read-only + issue/MR management (update ticket, post comments, remove worktree). Use for wrap-up steps after code is already pushed.'
WHERE name = 'post-execution' AND is_builtin = true;
