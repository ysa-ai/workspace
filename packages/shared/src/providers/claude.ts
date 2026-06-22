import type { ProviderAdapter, CommandOpts, ParsedOutput, ContainerConfig } from "./types";
import type { ParsedLogEntry } from "../types";
import { MODELS_BY_PROVIDER } from "./models";

// ── Auth ──────────────────────────────────────────────────────────────────────
// Claude OAuth/Keychain token resolution lives in the @ysa-ai/ysa runtime (the
// process that launches containers) — there is exactly ONE copy of the Keychain
// logic there, so it can't drift across duplicates (the bug that previously broke
// OAuth refresh). This shared adapter is used only for models, command building,
// and log parsing; its getAuthEnv supports ANTHROPIC_API_KEY and otherwise defers
// to the runtime.

async function getClaudeAuthEnv(): Promise<Record<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { ANTHROPIC_API_KEY: apiKey };
  }
  throw new Error(
    "Claude OAuth token resolution is handled by the @ysa-ai/ysa runtime, not the shared adapter. Set ANTHROPIC_API_KEY, or launch via the runtime.",
  );
}

// ── Log parsing ───────────────────────────────────────────────────────────────

function parseClaudeLogLine(rawLine: string): ParsedLogEntry | null {
  if (!rawLine.trim()) return null;
  let obj: any;
  try {
    obj = JSON.parse(rawLine);
  } catch {
    return null;
  }

  if (obj.type === "system" && obj.subtype === "progress") {
    return {
      type: "progress",
      icon: "progress",
      text: obj.message || "Working...",
    };
  }

  if (obj.type === "system" && obj.subtype === "init") {
    return {
      type: "system",
      icon: "init",
      text: `Session started — model: ${obj.model}, tools: ${obj.tools?.length || 0}`,
      session_id: obj.session_id,
    };
  }

  if (obj.type === "assistant" && obj.message?.content) {
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        return { type: "assistant", icon: "message", text: block.text.trim() };
      }
      if (block.type === "tool_use") {
        const input = block.input || {};
        let detail = "";
        if (block.name === "Read" || block.name === "Write" || block.name === "Edit") {
          detail = input.file_path || "";
        } else if (block.name === "Bash") {
          detail = input.command || "";
        } else if (block.name === "Glob") {
          detail = input.pattern || "";
        } else if (block.name === "Grep") {
          detail = input.pattern || "";
        } else {
          detail = JSON.stringify(input);
        }
        return {
          type: "tool_call",
          icon: "tool",
          tool: block.name,
          text: detail,
        };
      }
    }
  }

  if (obj.type === "result") {
    return {
      type: "result",
      icon: obj.subtype === "success" ? "success" : "error",
      text:
        obj.result?.slice(0, 300) ||
        `${obj.subtype} — ${obj.num_turns || "?"} turns, cost: $${obj.total_cost_usd?.toFixed(4) || "?"}`,
      cost: obj.total_cost_usd,
      turns: obj.num_turns,
      usage: {
        input_tokens: obj.usage?.input_tokens,
        output_tokens: obj.usage?.output_tokens,
        cache_read_tokens: obj.usage?.cache_read_input_tokens,
        cache_creation_tokens: obj.usage?.cache_creation_input_tokens,
      },
    };
  }

  return null;
}

// ── Output parsing ────────────────────────────────────────────────────────────

function parseClaudeOutput(logContent: string, skipLinesBefore = 0): ParsedOutput {
  const lines = logContent.split("\n");
  const relevantLines = skipLinesBefore > 0 ? lines.slice(skipLinesBefore) : lines;

  let sessionId: string | null = null;
  let maxTurnsReached = false;
  let agentAborted = false;
  let abortReason: string | null = null;
  let lastError: string | null = null;

  for (const line of relevantLines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);

      if (parsed.type === "system" && parsed.session_id) {
        sessionId = parsed.session_id;
      }

      if (parsed.type === "result" && parsed.subtype === "error_max_turns") {
        maxTurnsReached = true;
      }

      if (parsed.type === "assistant" && parsed.message?.content) {
        for (const block of parsed.message.content) {
          if (block.type === "text" && block.text) {
            lastError = block.text.slice(0, 200);
            const abortMatch = block.text.match(/\[TASK_ABORTED\]:\s*(.*)/);
            if (abortMatch) {
              agentAborted = true;
              abortReason = abortMatch[1].trim().slice(0, 200);
            }
          }
        }
      }
    } catch {
      // Not JSON — skip
    }
  }

  // Also check all lines for session_id (it may appear before skipLinesBefore)
  if (!sessionId) {
    for (const line of lines) {
      const match = line.match(/"session_id":"([^"]*)"/);
      if (match) sessionId = match[1];
    }
  }

  return { sessionId, maxTurnsReached, agentAborted, abortReason, lastError };
}

function extractClaudeSessionId(logContent: string): string | null {
  const matches = logContent.match(/"session_id":"([^"]*)"/g);
  if (!matches) return null;
  const last = matches[matches.length - 1];
  return last.match(/"session_id":"([^"]*)"/)?.[1] ?? null;
}

// ── Container init script ─────────────────────────────────────────────────────

const CLAUDE_INIT_SCRIPT = `
if [ ! -f /home/agent/.claude/settings.json ] && [ -f /etc/claude-defaults/settings.json ]; then
  mkdir -p /home/agent/.claude/hooks
  cp /etc/claude-defaults/settings.json /home/agent/.claude/settings.json
  cp /etc/claude-defaults/hooks/sandbox-guard.sh /home/agent/.claude/hooks/sandbox-guard.sh 2>/dev/null
  chmod +x /home/agent/.claude/hooks/sandbox-guard.sh 2>/dev/null
fi
if [ -n "\${ALLOWED_TOOLS:-}" ] && [ -f /home/agent/.claude/settings.json ]; then
  TOOLS_JSON=\$(echo "\$ALLOWED_TOOLS" | tr ',' '\\n' | jq -R . | jq -s . 2>/dev/null || echo '[]')
  if [ "\$TOOLS_JSON" != '[]' ]; then
    jq --argjson t "\$TOOLS_JSON" '.permissions.allow = \$t' /home/agent/.claude/settings.json > /tmp/s.json 2>/dev/null && mv /tmp/s.json /home/agent/.claude/settings.json
  fi
fi
if [ -f /home/agent/.claude.json ]; then
  jq '.hasCompletedOnboarding = true | .projects["/workspace"].hasTrustDialogAccepted = true' /home/agent/.claude.json > /tmp/cj.json 2>/dev/null && mv /tmp/cj.json /home/agent/.claude.json
else
  echo '{"hasCompletedOnboarding":true,"projects":{"/workspace":{"hasTrustDialogAccepted":true}}}' > /home/agent/.claude.json
fi
`.trim();

// ── Command builder ───────────────────────────────────────────────────────────

function buildClaudeCommand(opts: CommandOpts): string[] {
  const args: string[] = [];

  if (opts.interactive) {
    if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
    if (opts.model) args.push("--model", opts.model);
    args.push("--add-dir", "/workspace", "--dangerously-skip-permissions");
    return args;
  }

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
    if (!opts.usePromptUrl) {
      args.push("-p", opts.resumePrompt ?? "Continue from where you left off. Complete the remaining tasks.");
    }
  } else if (!opts.usePromptUrl && opts.prompt) {
    args.push("-p", opts.prompt);
  }

  if (opts.allowedTools) {
    const tools = opts.allowedTools.split(",").filter((t) => t !== "mcp__*").join(",");
    if (tools) args.push("--tools", tools);
    if (!opts.allowedTools.includes("mcp__")) {
      args.push("--strict-mcp-config");
    }
  } else {
    args.push("--strict-mcp-config");
  }

  if (opts.model) {
    args.push("--model", opts.model);
  }

  args.push(
    "--add-dir", "/workspace",
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", String(opts.maxTurns ?? 60),
  );

  return args;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  name: "Claude Code",
  agentBinary: "claude",
  models: MODELS_BY_PROVIDER.claude,

  authEnvKeys: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
  getAuthEnv: getClaudeAuthEnv,

  buildCommand: buildClaudeCommand,

  parseLogLine: parseClaudeLogLine,
  parseOutput: parseClaudeOutput,
  extractSessionId: extractClaudeSessionId,

  containerImage: "sandbox-claude",
  packageManager: "apt",
  bypassHosts: ["api.anthropic.com", "statsig.anthropic.com"],

  initContainerConfig(_opts?: { model?: string }): ContainerConfig {
    return {
      initScript: CLAUDE_INIT_SCRIPT,
      envVars: {},
    };
  },

  capabilities: {
    sessionResume: true,
    maxTurns: true,
    toolRestriction: true,
    hooks: true,
    streamingOutput: true,
    maxPrice: false,
  },

  mapToolNames(tools: string[]): string[] {
    return tools;
  },
};
