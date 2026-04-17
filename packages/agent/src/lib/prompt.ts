import { readFile } from "fs/promises";
import { join } from "path";
import type { AgentConfig } from "./config";
import type { StepDefinition } from "./phase-runner";
import { MODULE_SYSTEM_INSTRUCTIONS, MODULE_RESULT_SCHEMAS, buildModuleConfigBlock } from "./modules";

const NEVER_MENTION_AI = `

---

> **IMPORTANT:** NEVER mention Claude, AI, or any AI tool anywhere — no code comments, no commit messages, no issue comments, no footers, no attribution of any kind. Write everything as a human developer would.`;

const ABORT_SUFFIX = `

---
## Error handling (CRITICAL — read this last)

If you encounter a blocker that prevents you from completing this phase — missing permissions, unavailable tools, network failures, or any other fundamental issue — you MUST stop immediately.

**Network policy blocks are PERMANENT.** If any HTTP request returns 403 "Blocked by network policy", the request will NEVER succeed regardless of how you reformulate it. Do NOT try alternative URLs, different tools, encoding tricks, or workarounds. The network proxy enforces a strict allow-list — anything blocked is intentionally blocked.

**On ANY blocker:**
1. Do NOT retry the same action
2. Do NOT try to work around it
3. Write \`[TASK_ABORTED]: <brief reason>\` as your FINAL message
4. Stop immediately — do not continue with other steps`;

function buildIssueCommands(issueSource: "gitlab" | "github"): Record<string, string> {
  const base = "$ISSUE_BASE_URL";
  const pid = "$ISSUE_PROJECT_ID";
  const iid = "$ISSUE_IID";

  if (issueSource === "github") {
    const auth = `-H "Authorization: Bearer $ISSUE_TOKEN" -H "Accept: application/vnd.github+json"`;
    return {
      get_issue:      `curl -s ${auth} "${base}/repos/${pid}/issues/${iid}"`,
      list_comments:  `curl -s ${auth} "${base}/repos/${pid}/issues/${iid}/comments"`,
      create_comment: `curl -s -X POST ${auth} -H "Content-Type: application/json" -d '{"body":"<comment>"}' "${base}/repos/${pid}/issues/${iid}/comments"`,
      update_issue:   `curl -s -X PATCH ${auth} -H "Content-Type: application/json" -d '<JSON>' "${base}/repos/${pid}/issues/${iid}"`,
      create_mr:      `curl -s -X POST ${auth} -H "Content-Type: application/json" -d '<JSON>' "${base}/repos/${pid}/pulls"`,
      list_mrs:       `curl -s ${auth} "${base}/repos/${pid}/pulls?state=open"`,
    };
  }

  // GitLab (default) — Authorization: Bearer works with PATs and passes through the container network proxy
  const auth = `-H "Authorization: Bearer $ISSUE_TOKEN"`;
  return {
    get_issue:      `curl -s ${auth} "${base}/projects/${pid}/issues/${iid}"`,
    list_comments:  `curl -s ${auth} "${base}/projects/${pid}/issues/${iid}/notes"`,
    create_comment: `curl -s -X POST ${auth} -H "Content-Type: application/json" -d '{"body":"<comment>"}' "${base}/projects/${pid}/issues/${iid}/notes"`,
    update_issue:   `curl -s -X PUT ${auth} -H "Content-Type: application/json" -d '<JSON>' "${base}/projects/${pid}/issues/${iid}"`,
    create_mr:      `curl -s -X POST ${auth} -H "Content-Type: application/json" -d '<JSON>' "${base}/projects/${pid}/merge_requests"`,
    list_mrs:       `curl -s ${auth} "${base}/projects/${pid}/merge_requests?state=opened"`,
  };
}

// Shell script — uses $GIT_TOKEN and $ALLOWED_BRANCH env vars injected by the platform
const GIT_PUSH_CMD = [
  "REMOTE=$(git remote get-url origin | sed 's|^git@\\([^:]*\\):\\(.*\\)$|https://\\1/\\2|')",
  'AUTH_REMOTE=$(echo "$REMOTE" | sed "s|https://|https://oauth2:${GIT_TOKEN}@|")',
  'git push "$AUTH_REMOTE" "$ALLOWED_BRANCH"',
].join("\n");

export async function composePrompt(
  phase: string,
  issueId: string,
  config: AgentConfig,
  dashboardUrl: string,
  stepDef: StepDefinition,
  userPrompt?: string,
): Promise<string> {
  let preamble = "You are running in HEADLESS MODE as a sandboxed instance. You CANNOT ask questions to the user. Execute all steps autonomously.\n\n";
  preamble += "- **Worktree** (your working copy): `{WORKTREE}`\n";
  preamble += "- **Main repo** (read-only reference): `{MAIN_REPO}`\n";
  if (stepDef.containerMode === "readonly") {
    preamble += "\n> **READ-ONLY MODE** — Do NOT create, edit, or delete any files. Analyse only.\n";
  }
  preamble += "\n---\n\n";

  let prompt = preamble;

  const hasPromptModule = stepDef.modules.some((m) => m.name === "__prompt__");
  const orderableModules = hasPromptModule
    ? stepDef.modules
    : [{ name: "__prompt__", prompt: "" }, ...stepDef.modules];

  if (orderableModules.length > 1) {
    let orderBlock = "\n\n---\n\n## Execution Order (REQUIRED)\n\nComplete these in sequence — do not start the next until the current one is fully done:\n";
    for (const [i, mod] of orderableModules.entries()) {
      const label = mod.name === "__prompt__"
        ? "Step prompt — complete the main task described below"
        : mod.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      orderBlock += `${i + 1}. **${label}**\n`;
    }
    prompt += orderBlock;
  }

  for (const mod of orderableModules) {
    if (mod.name === "fetch_issue" && config.sourceType === "prompt") continue;
    if (mod.name === "__prompt__") {
      if (config.sourceType === "prompt") {
        prompt += `\n\n---\n\n# Task\n\n${userPrompt ?? ""}\n`;
      } else {
        prompt += "\n\n---\n\n" + (stepDef.promptTemplate || `# Step: ${phase}\n\nComplete the task for issue #{ISSUE_ID} and submit results to the dashboard.\n`);
        const customerTemplate = join(config.projectRoot, ".claude", "prompts", `${phase}.md`);
        try {
          const customerContent = await readFile(customerTemplate, "utf-8");
          prompt += `\n\n---\n\n## Project-Specific Context\n\n${customerContent}`;
        } catch {
          // No customer template — skip
        }
      }
    } else {
      const systemInstr = MODULE_SYSTEM_INSTRUCTIONS[mod.name];
      if (systemInstr) prompt += `\n\n---\n\n${systemInstr}`;
      if (mod.prompt?.trim()) prompt += `\n\n**Additional instructions:**\n${mod.prompt.trim()}`;
      const configBlock = buildModuleConfigBlock(mod.name, mod.config ?? {});
      if (configBlock) prompt += configBlock;
    }
  }

  // Result submission — one section per module, each posts to its own endpoint
  const moduleNames = stepDef.modules.map((m) => m.name);
  let resultBlock = "\n\n---\n\n## Result Submission (REQUIRED — do this last)\n\nComplete all submissions below before finishing.\n";

  for (const moduleName of moduleNames) {
    if (moduleName === "plan") {
      resultBlock += `\n### Plan document\n\nWrite your plan to \`/workspace/.ysa-plan.md\` then submit:\n\`\`\`bash\ncurl -s -X POST {DASHBOARD_URL}/api/tasks/{ISSUE_ID}/steps/${stepDef.slug}/module/plan \\\n  -H "Content-Type: text/plain" \\\n  -H "Authorization: Bearer $YSA_SUBMIT_TOKEN" \\\n  --data-binary @/workspace/.ysa-plan.md\n\`\`\`\n`;
    } else {
      const schema = MODULE_RESULT_SCHEMAS[moduleName];
      if (schema) {
        const label = moduleName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const file = `/workspace/.ysa-${moduleName}.json`;
        resultBlock += `\n### ${label}\n\nWrite to \`${file}\`:\n\`\`\`json\n{\n`;
        for (const [field, desc] of Object.entries(schema)) {
          resultBlock += `  "${field}": "...",       // ${desc}\n`;
        }
        resultBlock += `}\n\`\`\`\n\nSubmit:\n\`\`\`bash\ncurl -s -X POST {DASHBOARD_URL}/api/tasks/{ISSUE_ID}/steps/${stepDef.slug}/module/${moduleName} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $YSA_SUBMIT_TOKEN" \\\n  --data-binary @${file}\n\`\`\`\n`;
      }
    }
  }
  prompt += resultBlock;
  prompt += NEVER_MENTION_AI;

  // Variable substitution — global
  const containerDashboardUrl = dashboardUrl.replace(/localhost|127\.0\.0\.1/, "host.containers.internal");
  prompt = prompt
    .replaceAll("{ISSUE_ID}", issueId)
    .replaceAll("{WORKTREE}", "/workspace")
    .replaceAll("{OUTPUT_DIR}", "/output")
    .replaceAll("{MAIN_REPO}", "/repo.git")
    .replaceAll("{DASHBOARD_URL}", containerDashboardUrl)
    .replaceAll("{DASHBOARD_PORT}", String(config.dashboardPort))
    .replaceAll("{TEST_CMD}", config.testCmd || "")
    .replaceAll("{TEST_INSTRUCTIONS}", "")
    .replaceAll("{PREV_STEP_RESULT}", stepDef.prevStepResult ?? "");

  // Variable substitution — provider-specific
  const src = config.issueSource ?? "gitlab";
  const gh = src === "github";
  const cmds = buildIssueCommands(src);

  prompt = prompt
    .replaceAll("{ISSUE_SOURCE_NAME}", gh ? "GitHub" : "GitLab")
    .replaceAll("{PR_TERM}", gh ? "pull request" : "merge request")
    .replaceAll("{PR_TERM_SHORT}", gh ? "PR" : "MR")
    .replaceAll("{ISSUE_GET_CMD}", cmds.get_issue)
    .replaceAll("{ISSUE_COMMENTS_CMD}", cmds.list_comments)
    .replaceAll("{COMMENT_CMD}", cmds.create_comment)
    .replaceAll("{UPDATE_ISSUE_CMD}", cmds.update_issue)
    .replaceAll("{MR_CREATE_CMD}", cmds.create_mr)
    .replaceAll("{MR_LIST_CMD}", cmds.list_mrs)
    .replaceAll("{GIT_PUSH_CMD}", GIT_PUSH_CMD);

  prompt += ABORT_SUFFIX;

  return prompt;
}
