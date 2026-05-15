// Module system instructions — injected into prompts by the platform, not user-editable.
export const MODULE_SYSTEM_INSTRUCTIONS: Record<string, string> = {
  fetch_issue: `Fetch the issue content — do this before anything else in this step:
1. Get the issue: \`{ISSUE_GET_CMD}\`
2. Get the comments: \`{ISSUE_COMMENTS_CMD}\`
3. Download any attachments referenced in the issue or comments using \`curl\`.
Do NOT use \`gh\`, \`WebFetch\`, or any MCP tool to read the issue.`,

  plan: `Write a comprehensive plan document for this issue. The plan must be detailed enough that someone can execute it without re-reading the issue. Reference specific file paths, function names, and line numbers where possible. If the issue is ambiguous, make reasonable assumptions and document them.`,

  delivery: `After implementing your changes, deliver them as follows:
1. **Stage files** — use \`git add <specific files>\` only. Never \`git add .\` or \`git add -A\`.
2. **Commit** — write a clear, descriptive commit message explaining what changed and why. No AI attribution of any kind.
3. **Rebase** — run \`git fetch origin && git rebase origin/main\` before pushing.
4. **Push** — run \`{GIT_PUSH_CMD}\`. Do NOT use any MCP tool to push.
5. **Open {PR_TERM}** — run \`{MR_CREATE_CMD}\`.`,

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

  frontend_debug: `Verify the frontend visually using Playwright (system Chromium, headless).

**Only run this module if the changes include frontend code** (UI components, styles, client-side logic, templates). If the changes are purely backend, infrastructure, or configuration with no visible frontend impact, set status to "skipped" in your result and stop.

**Setup** — write this capture script once:
\`\`\`
mkdir -p /workspace/.playwright
cat > /workspace/.playwright/capture.ts << 'EOF'
import { chromium } from "playwright-core";
const url = process.argv[2];
if (!url) { console.error("Usage: bun capture.ts <url>"); process.exit(1); }
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-crash-reporter", "--no-crashpad", "--disable-gpu"],
});
const page = await browser.newPage();
const consoleErrors: string[] = [];
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
const screenshotPath = \`/workspace/.playwright/\${Date.now()}.png\`;
await page.screenshot({ path: screenshotPath, fullPage: true });
const tree = await page.accessibility.snapshot();
console.log(JSON.stringify({ screenshotPath, consoleErrors, accessibility: tree }, null, 2));
await browser.close();
EOF
\`\`\`

**Workflow:**
0. Run this diagnostic first and include the output in your result summary: \`echo "HOME=$HOME" && (mkdir -p "$HOME/.turbo-test" && echo "HOME writable: yes" && rmdir "$HOME/.turbo-test" || echo "HOME writable: NO")\`
1. Start **all** configured dev servers listed in the preamble in the background, each logging to a file (e.g. \`cmd > /tmp/server-name.log 2>&1 &\`). The app typically needs API + frontend servers running together.
2. Wait 5 seconds, then read each server's log file to check for startup crashes. If a server crashed, set status to \`"failed"\` with the crash output in \`summary\` and stop immediately.
3. Poll each server's port every 2 seconds for up to 60 seconds: \`curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>\`. Stop as soon as you get 200/301/302. If not ready after 60 seconds, read its log again and set status to \`"failed"\` with the error — stop immediately.
4. Run \`bun /workspace/.playwright/capture.ts <url>\` — captures a screenshot and accessibility tree.
5. Read the PNG file at the path printed in the output using your Read tool to visually inspect the UI.
6. Check \`consoleErrors\` in the JSON output for JS errors.
7. Navigate to other pages or states as needed by running the script again with different URLs.
8. Fix any visual or functional issues found, re-run to confirm. Read each PNG you take.
9. Stop the dev server when done.`,

  change_report: `After implementing your changes, commit them locally — do NOT push or create a pull request or merge request.
1. **Stage files** — use \`git add <specific files>\` only. Never \`git add .\` or \`git add -A\`.
2. **Commit** — write a clear, descriptive commit message explaining what changed and why. No AI attribution of any kind.
3. **Do NOT push** — do not run \`git push\`. The diff will be captured automatically from your local commit.`,

  issue_update: `Update the issue according to the configured actions:
1. **Post comment** — run \`{COMMENT_CMD}\` with the comment body. The comment must summarise: what was done, link to the {PR_TERM} if one was created, test results if available, and any follow-up items.
2. **Update metadata** — apply any label or status changes specified in the configuration block below using \`{UPDATE_ISSUE_CMD}\`.
3. Do not close the issue unless explicitly configured to do so.`,
};

// APT packages required by each module — installed into the project container image.
export const MODULE_APT_PACKAGES: Record<string, string[]> = {
  frontend_debug: ["chromium"],
};

// Global packages required by each module — format: "<manager>:<package>", e.g. "bun:playwright-core", "pip:playwright".
export const MODULE_GLOBAL_PACKAGES: Record<string, string[]> = {
  frontend_debug: ["bun:playwright-core"],
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
  frontend_debug: {
    status: '"passed" | "failed" | "skipped"',
    summary: "string — what was verified and any issues found",
    screenshots: "string[] — base64-encoded PNG screenshots as proof",
    console_errors: "string — JS console errors detected, empty string if none",
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
