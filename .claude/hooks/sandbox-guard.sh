#!/bin/bash
# sandbox-guard.sh — Security hook for sandboxed Claude Code instances
#
# Called on every PreToolUse event (Bash, Read, Edit, Write).
# Uses CLAUDE_SANDBOX_ISSUE env var to distinguish master (unrestricted)
# from sandboxed sub-instances (restricted).
#
# Paths are derived from env vars set by the dashboard's spawnPhase:
#   PROJECT_ROOT, WORKTREE_PREFIX, ISSUES_DIR
#
# Exit 0 = allow, Exit 2 = block (message in stderr)

set -euo pipefail

# Master instance — no restrictions
if [ -z "${CLAUDE_SANDBOX_ISSUE:-}" ]; then
  exit 0
fi

# Ensure jq is available
if ! command -v jq &>/dev/null; then
  echo "BLOCKED: jq is required for sandbox-guard.sh but not found" >&2
  exit 2
fi

ISSUE_ID="$CLAUDE_SANDBOX_ISSUE"
WORKTREE="${WORKTREE_PREFIX:-}${ISSUE_ID}"
MAIN_REPO="${PROJECT_ROOT:-}"
OUTPUT_DIR="${ISSUES_DIR:-/tmp/workflow-agent-issues}/${ISSUE_ID}"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# ---------------------------------------------------------------------------
# Sensitive file patterns (blocked for Read, Edit, Write)
# ---------------------------------------------------------------------------
SENSITIVE_PATTERNS='\.env$|\.env\.|credentials|secret|\.key$|\.pem$|\.cert$|\.p12$|id_rsa|id_ed25519'

check_sensitive_path() {
  local filepath="$1"
  if echo "$filepath" | grep -iEq "$SENSITIVE_PATTERNS"; then
    echo "BLOCKED: Access to sensitive file '$filepath' is not allowed in sandboxed mode (issue #${ISSUE_ID})" >&2
    exit 2
  fi
}

check_path_in_scope() {
  local filepath="$1"
  # Allow access to: worktree, output dir, main repo (read-only)
  case "$filepath" in
    ${WORKTREE}/*|${OUTPUT_DIR}/*|${MAIN_REPO}/*|/tmp/workflow-agent-issues/${ISSUE_ID}/*)
      return 0
      ;;
    *)
      echo "BLOCKED: Path '$filepath' is outside the allowed scope for issue #${ISSUE_ID}" >&2
      exit 2
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Tool-specific checks
# ---------------------------------------------------------------------------
case "$TOOL_NAME" in

  Bash)
    COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

    # Block destructive commands
    if echo "$COMMAND" | grep -Eq 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force|-rf|-fr)'; then
      echo "BLOCKED: Destructive 'rm' command not allowed in sandbox (issue #${ISSUE_ID})" >&2
      exit 2
    fi
    if echo "$COMMAND" | grep -Eq 'git\s+push\s+.*--force'; then
      ALLOWED_PUSH_BRANCH="${ALLOWED_BRANCH:-}"
      if [ -z "$ALLOWED_PUSH_BRANCH" ] || ! echo "$COMMAND" | grep -qF "$ALLOWED_PUSH_BRANCH"; then
        echo "BLOCKED: 'git push --force' only allowed to the issue branch (issue #${ISSUE_ID})" >&2
        exit 2
      fi
    fi
    if echo "$COMMAND" | grep -Eq 'git\s+reset\s+--hard'; then
      echo "BLOCKED: 'git reset --hard' not allowed in sandbox (issue #${ISSUE_ID})" >&2
      exit 2
    fi
    if echo "$COMMAND" | grep -Eq 'git\s+checkout\s+\.'; then
      echo "BLOCKED: 'git checkout .' not allowed in sandbox (issue #${ISSUE_ID})" >&2
      exit 2
    fi
    if echo "$COMMAND" | grep -Eq 'git\s+clean\s+-[a-zA-Z]*f'; then
      echo "BLOCKED: 'git clean -f' not allowed in sandbox (issue #${ISSUE_ID})" >&2
      exit 2
    fi
    if echo "$COMMAND" | grep -Eq '^sudo\s'; then
      echo "BLOCKED: 'sudo' not allowed in sandbox (issue #${ISSUE_ID})" >&2
      exit 2
    fi
    if echo "$COMMAND" | grep -Eq 'chmod\s+777'; then
      echo "BLOCKED: 'chmod 777' not allowed in sandbox (issue #${ISSUE_ID})" >&2
      exit 2
    fi

    # Block reading .env content via bash (cat, head, tail, less, more)
    if echo "$COMMAND" | grep -Eq '(cat|head|tail|less|more|bat)\s+.*\.env'; then
      echo "BLOCKED: Reading .env file content via shell not allowed in sandbox (issue #${ISSUE_ID})" >&2
      exit 2
    fi

    # Block cp of .env files (dashboard handles this during init)
    if echo "$COMMAND" | grep -Eq 'cp\s+.*\.env'; then
      echo "BLOCKED: Copying .env files not allowed in sandbox (issue #${ISSUE_ID}). This is handled by the dashboard init." >&2
      exit 2
    fi

    # Allow the command
    exit 0
    ;;

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    check_sensitive_path "$FILE_PATH"
    # Read is allowed from anywhere in scope (including main repo for analysis)
    exit 0
    ;;

  Edit)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    check_sensitive_path "$FILE_PATH"
    check_path_in_scope "$FILE_PATH"
    # Block edits to main repo (only worktree and output dir are writable)
    case "$FILE_PATH" in
      ${MAIN_REPO}/*)
        echo "BLOCKED: Cannot edit files in main repo from sandbox. Work in worktree: ${WORKTREE}" >&2
        exit 2
        ;;
    esac
    exit 0
    ;;

  Write)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    check_sensitive_path "$FILE_PATH"
    check_path_in_scope "$FILE_PATH"
    # Block writes to main repo
    case "$FILE_PATH" in
      ${MAIN_REPO}/*)
        echo "BLOCKED: Cannot write files in main repo from sandbox. Work in worktree: ${WORKTREE}" >&2
        exit 2
        ;;
    esac
    exit 0
    ;;

  *)
    # Other tools (Glob, Grep, WebSearch, MCP, etc.) — allow
    exit 0
    ;;
esac
