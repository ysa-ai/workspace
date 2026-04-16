// Module system instructions — injected into prompts by the platform, not user-editable.
export const MODULE_SYSTEM_INSTRUCTIONS: Record<string, string> = {
  fetch_issue: `Fetch the issue content — do this before anything else in this step:
1. Call \`{MCP_GET_ISSUE}\` with parameters \`{MCP_ISSUE_ARGS}\` as your very first action.
2. Call \`{MCP_LIST_COMMENTS}\` with parameters \`{MCP_COMMENTS_ARGS}\` to retrieve all comments.
3. Download any attachments referenced in the issue or comments.
Do NOT use \`gh\`, \`curl\`, \`WebFetch\`, or any other method to read the issue. \`gh\` is not installed. curl to {ISSUE_SOURCE_NAME} APIs is blocked. The MCP tool is the ONLY way.`,

  plan: `Write a comprehensive plan document for this issue. The plan must be detailed enough that someone can execute it without re-reading the issue. Reference specific file paths, function names, and line numbers where possible. If the issue is ambiguous, make reasonable assumptions and document them.`,

  delivery: `After implementing your changes, deliver them as follows:
1. **Stage files** — use \`git add <specific files>\` only. Never \`git add .\` or \`git add -A\`.
2. **Commit** — write a clear, descriptive commit message explaining what changed and why. No AI attribution of any kind.
3. **Rebase** — run \`git fetch origin && git rebase origin/main\` before pushing.
4. **Push** — use the \`{MCP_PUSH_FILES}\` MCP tool with \`{MCP_PUSH_ARGS}\`. Do NOT use \`git push\`.
5. **Open {PR_TERM}** — use the \`{MCP_CREATE_PR}\` MCP tool targeting the default branch.`,

  unit_tests: `Write unit tests covering every significant change you implemented, then run the full test suite.
1. **Write tests** — for every significant change, write unit tests in the appropriate test file(s). Follow the existing test patterns, naming conventions, and file structure. Cover the happy path and key edge cases. If no test files exist, create them following standard conventions for the language/framework. Tests must NOT require a running server.
2. **Run tests** — execute \`{TEST_CMD}\`. Fix any failures before proceeding. Do not delete or weaken existing tests to make them pass.
3. **Report** — set \`tests\` to \`"passed"\`, \`"failed"\`, or \`"skipped"\` (only if \`{TEST_CMD}\` is empty). Set \`test_details\` to a brief summary of results or error output.`,

  manual_qa: `Generate a QA checklist a human can follow to manually verify the changes.
1. Produce 3–8 specific, testable criteria directly relevant to the changes made.
2. Assign sequential IDs: \`qa-1\`, \`qa-2\`, etc.
3. Focus on user-facing behaviour, edge cases, and regressions. Do not include criteria that require infrastructure unavailable to a reviewer.
4. Write each description as multiple bullet lines: one "- <action step>" per line, then a final "- Expected: <outcome>" line. Example:
   - Open a notice in the Edition app.
   - Inspect the date tag in the header.
   - Expected: The date displayed is DMAJ, not DMIS.`,

  change_report: `After implementing your changes, commit them locally — do NOT push or create a pull request or merge request.
1. **Stage files** — use \`git add <specific files>\` only. Never \`git add .\` or \`git add -A\`.
2. **Commit** — write a clear, descriptive commit message explaining what changed and why. No AI attribution of any kind.
3. **Do NOT push** — do not run \`git push\` and do not use any MCP tool to push files or open a PR/MR. The diff will be captured automatically from your local commit.`,

  issue_update: `Update the issue according to the configured actions:
1. **Post comment** — use \`{MCP_CREATE_COMMENT}\` with \`{MCP_COMMENTS_ARGS}\`. The comment must summarise: what was done, link to the {PR_TERM} if one was created, test results if available, and any follow-up items.
2. **Update metadata** — apply any label or status changes specified in the configuration block below.
3. Do not close the issue unless explicitly configured to do so.`,
};

// JSON schema for each module's result submission.
export const MODULE_RESULT_SCHEMAS: Record<string, Record<string, string>> = {
  delivery: {
    mr_url: "string — full MR/PR URL (empty string if no PR was created)",
    branch: "string — branch name",
    commit_hash: "string — full commit SHA",
    commit_message: "string — commit message",
    files_changed: "string[] — list of changed file paths",
  },
  unit_tests: {
    tests: '"passed" | "failed" | "skipped"',
    test_details: "string — test output summary",
  },
  manual_qa: {
    qa_items: '[{id: string, description: string}] — checklist items for manual verification',
  },
  issue_update: {
    comment_url: "string — URL of the posted comment, empty string if not available",
    note_content: "string — full markdown text of the comment you posted",
    labels_added: "string[] — labels added to the issue",
    labels_removed: "string[] — labels removed from the issue",
  },
};

export function buildModuleConfigBlock(name: string, config: Record<string, unknown>): string {
  if (name === "issue_update") {
    const lines: string[] = ["\n\n**Configured actions (apply exactly as specified):**"];
    if (config.postComment !== false) lines.push("- Post a summary comment on the issue");
    const addLabels = Array.isArray(config.addLabels) ? config.addLabels as string[] : [];
    const removeLabels = Array.isArray(config.removeLabels) ? config.removeLabels as string[] : [];
    if (addLabels.length > 0) lines.push(`- Add labels: ${addLabels.map((l) => `\`${l}\``).join(", ")}`);
    if (removeLabels.length > 0) lines.push(`- Remove labels: ${removeLabels.map((l) => `\`${l}\``).join(", ")}`);
    if (config.closeIssue) lines.push("- Close the issue after posting the comment");
    return lines.join("\n");
  }
  if (name === "delivery" && config.createPR === false) {
    return "\n\n**Configured actions:** Push the branch only — do NOT create a PR/MR.";
  }
  return "";
}
