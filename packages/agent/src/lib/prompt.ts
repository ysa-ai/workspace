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

If you encounter a blocker that prevents you from completing this phase — missing permissions, unavailable tools, network failures, MCP tool errors, or any other fundamental issue — you MUST stop immediately.

**Network policy blocks are PERMANENT.** If any HTTP request returns 403 "Blocked by network policy", the request will NEVER succeed regardless of how you reformulate it. Do NOT try alternative URLs, different tools, encoding tricks, or workarounds. The network proxy enforces a strict allow-list — anything blocked is intentionally blocked.

**On ANY blocker:**
1. Do NOT retry the same action
2. Do NOT try to work around it
3. Write \`[TASK_ABORTED]: <brief reason>\` as your FINAL message
4. Stop immediately — do not continue with other steps`;

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
  if (stepDef.toolPreset === "readonly") {
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

  let mcpIssueArgs = `issue_iid: "${issueId}"`;
  let mcpCommentsArgs = `issue_iid: "${issueId}"`;
  if (config.issueUrlTemplate) {
    try {
      const urlStr = config.issueUrlTemplate.replace("{id}", issueId);
      const url = new URL(urlStr);
      if (gh) {
        const parts = url.pathname.split("/").filter(Boolean);
        mcpIssueArgs = `owner: "${parts[0] ?? ""}", repo: "${parts[1] ?? ""}", issue_number: ${issueId}`;
        mcpCommentsArgs = mcpIssueArgs;
      } else {
        const projectPath = url.pathname.split("/-/")[0]?.replace(/^\//, "") ?? "";
        mcpIssueArgs = `project_id: "${projectPath}", issue_iid: "${issueId}"`;
        mcpCommentsArgs = mcpIssueArgs;
      }
    } catch {
      // keep defaults
    }
  }

  prompt = prompt
    .replaceAll("{ISSUE_SOURCE_NAME}", gh ? "GitHub" : "GitLab")
    .replaceAll("{MCP_GET_ISSUE}", gh ? "mcp__github__get_issue" : "mcp__gitlab__get_issue")
    .replaceAll("{MCP_LIST_COMMENTS}", gh ? "mcp__github__list_issue_comments" : "mcp__gitlab__list_issue_discussions")
    .replaceAll("{MCP_ISSUE_ARGS}", mcpIssueArgs)
    .replaceAll("{MCP_COMMENTS_ARGS}", mcpCommentsArgs)
    .replaceAll("{MCP_GET_FILE_CONTENTS}", gh ? "mcp__github__get_file_contents" : "mcp__gitlab__get_file_contents")
    .replaceAll("{MCP_PUSH_FILES}", gh ? "mcp__github__push_files" : "mcp__gitlab__push_files")
    .replaceAll("{MCP_CREATE_PR}", gh ? "mcp__github__create_pull_request" : "mcp__gitlab__create_merge_request")
    .replaceAll("{MCP_CREATE_COMMENT}", gh ? "mcp__github__create_issue_comment" : "mcp__gitlab__create_note")
    .replaceAll("{PR_TERM}", gh ? "pull request" : "merge request")
    .replaceAll("{PR_TERM_SHORT}", gh ? "PR" : "MR");

  prompt += ABORT_SUFFIX;

  return prompt;
}
