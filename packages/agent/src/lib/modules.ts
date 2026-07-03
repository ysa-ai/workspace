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

**\`"passed"\` means you actually exercised the changed feature end-to-end — nothing less.** If you cannot reach or trigger it (you cannot sign in, the page or state is unreachable, a required interaction is blocked), you MUST set status to \`"failed"\` and state plainly in \`summary\` what stopped you (e.g. "Could not sign in, so the rotation feature could not be tested"). NEVER report \`"passed"\` or "no visible UI regressions" for a feature you did not actually exercise — a feature you could not test is a \`"failed"\`, not a pass.

**Setup** — write this capture script once. It lives in /tmp (NOT the worktree) so it is never committed. Installing playwright-core in /tmp/.playwright (a non-project dir) makes \`import "playwright-core"\` resolve there — never use the worktree, whose lockfile has no playwright-core:
\`\`\`
mkdir -p /tmp/.playwright
( cd /tmp/.playwright && bun add playwright-core )
cat > /tmp/.playwright/capture.ts << 'EOF'
import { chromium } from "playwright-core";
const rawArgs = process.argv.slice(2);
const url = rawArgs[0];
let scope = "--viewport"; // --viewport | --full | <css-selector>
let waitFor: string | null = null; // --wait <css-selector|milliseconds>
for (let i = 1; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === "--wait") waitFor = rawArgs[++i] ?? null;
  else if (a.startsWith("--wait=")) waitFor = a.slice(7);
  else scope = a;
}
if (!url) { console.error("Usage: bun capture.ts <url> [--viewport|--full|<selector>] [--wait <selector|ms>]"); process.exit(1); }
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", \`--log-net-log=/ysa-logs/netlog-\${Date.now()}.json\`],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors: string[] = [];
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
const requestFailures: string[] = [];
page.on("requestfailed", r => { const e = r.failure()?.errorText || "failed"; if (e !== "net::ERR_ABORTED") requestFailures.push(\`\${e} \${r.url()}\`); });
page.on("crash", () => requestFailures.push("RENDERER_CRASHED (renderer process died — could be OOM, GPU, or a blocked syscall)"));
page.on("pageerror", e => requestFailures.push(\`PAGEERROR \${e.message}\`));
try {
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
// SPAs render after load; wait for the network to settle. networkidle may never fire on apps with
// websockets/long-polling, so cap it and move on. Pass --wait to gate on the real content explicitly.
await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
if (waitFor) {
  if (/^[0-9]+$/.test(waitFor)) await page.waitForTimeout(parseInt(waitFor));
  else await page.waitForSelector(waitFor, { state: "visible", timeout: 15000 }).catch(() => {});
} else {
  await page.waitForTimeout(500);
}

let png: Buffer;
if (scope === "--full") png = await page.screenshot({ fullPage: true });
else if (scope === "--viewport") png = await page.screenshot();
else png = await page.locator(scope).screenshot();

const localPath = \`/tmp/.playwright/\${Date.now()}.png\`;
await Bun.write(localPath, png);

// Re-encode to WebP q80 via Chromium's canvas (no extra native deps), ~40% smaller than JPEG.
const enc = await browser.newPage();
const webpDataUrl: string = await enc.evaluate(async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c.toDataURL("image/webp", 0.8);
}, png.toString("base64"));
await enc.close();
const webp = Buffer.from(webpDataUrl.split(",")[1], "base64");

// Upload to the dashboard, keyed by task — returns a stored URL to put in your result.
const res = await fetch("{DASHBOARD_URL}/api/tasks/{ISSUE_ID}/uploads", {
  method: "POST",
  headers: { "Content-Type": "image/webp", "Authorization": "Bearer " + process.env.YSA_SUBMIT_TOKEN },
  body: webp,
});
const uploadedUrl = res.ok ? (await res.json()).url : null;

const title = await page.title();
const outline = await page.$$eval("h1,h2,h3,button,a,[role]", els =>
  els.slice(0, 50).map(e => \`\${e.tagName.toLowerCase()}: \${(e.textContent || "").trim().slice(0, 60)}\`));
console.log(JSON.stringify({ uploadedUrl, localPath, scope, title, consoleErrors, requestFailures: requestFailures.slice(0, 50), requestFailureCount: requestFailures.length, outline }, null, 2));
} finally {
  await browser.close(); // always close so Chromium finalizes the netlog
}
EOF
\`\`\`

**Workflow:**
0. Run this diagnostic first and include the output in your result summary: \`echo "HOME=$HOME" && (mkdir -p "$HOME/.turbo-test" && echo "HOME writable: yes" && rmdir "$HOME/.turbo-test" || echo "HOME writable: NO")\`
1. Start **all** configured dev servers listed in the preamble in the background, each logging to a file (e.g. \`cmd > /tmp/server-name.log 2>&1 &\`). The app typically needs API + frontend servers running together.
2. Wait 5 seconds, then read each server's log file to check for startup crashes. If a server crashed, set status to \`"failed"\` with the crash output in \`summary\` and stop immediately.
3. Poll each server's port every 2 seconds for up to 60 seconds: \`curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>\`. Stop as soon as you get 200/301/302. If not ready after 60 seconds, read its log again and set status to \`"failed"\` with the error — stop immediately.
4. Run \`bun /tmp/.playwright/capture.ts <url> <scope> [--wait <selector|ms>]\`. Choose the **minimal scope** that proves your change, to keep stored screenshots small: a CSS selector (e.g. \`'.notice-form'\`) when one element is the proof, \`--viewport\` (default) when the visible fold tells the story, \`--full\` only when the whole page matters. This app renders content after load, so pass \`--wait <css-selector>\` to wait for the real element of the feature you are verifying (e.g. \`--wait '.notice-detail'\`) — never capture a loading spinner, skeleton, or blank state. Use \`--wait <ms>\` only as a fallback. The script captures, re-encodes to WebP, uploads to the dashboard, and prints \`uploadedUrl\` plus a local \`localPath\` and a DOM outline.
5. Read the PNG at \`localPath\` and confirm it actually shows the feature under test **in its final, settled state** — not a loading spinner/skeleton, a blank page, or a transient overlay/popover obscuring the content. If it does not, re-capture: add \`--wait <selector>\` for the real element, navigate directly to the intended destination URL rather than an intermediate state, and only then use the screenshot as proof. Do not submit a loading or wrong-state screenshot.
6. Check \`consoleErrors\` and \`requestFailures\` in the JSON output. If \`requestFailures\` shows the same \`net::\` error repeated across many URLs (e.g. \`net::ERR_INSUFFICIENT_RESOURCES\`), the page is overloading the network stack — an application bug (a runaway fetch/retry/WebSocket loop), not the container. \`RENDERER_CRASHED\` means an out-of-memory crash. A full network trace is written to \`.ysa/logs/<task>/netlog-*.json\` on the host for deep analysis.
7. Navigate to other pages or states as needed by running the script again with a different URL and scope. If the feature is behind a login, authenticate first using the **App login credentials** listed in the preamble — read the username/password from the named environment variables (never hard-code them) and sign in via Playwright before capturing. If you have no working credentials and cannot sign in, set status to \`"failed"\` per the rule above — do not report a pass.
8. Fix any visual or functional issues found, re-run to confirm. Read each PNG you take.
9. Put every \`uploadedUrl\` you captured into the \`screenshots\` array of your result.
10. Stop the dev servers when done.`,

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
    status: '"passed" | "failed" | "skipped" — "passed" ONLY if you actually exercised the changed feature; "failed" if you could not (e.g. could not sign in, feature unreachable); "skipped" only for non-frontend changes',
    summary: "string — what was verified and any issues found",
    screenshots: "string[] — uploadedUrl values printed by capture.ts (stored screenshot URLs), as proof",
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
