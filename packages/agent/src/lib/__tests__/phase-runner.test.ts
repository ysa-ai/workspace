import { describe, test, expect } from "bun:test";
import {
  composePrompt,
  buildAllowedToolsFromPreset,
  type StepDefinition,
} from "../phase-runner";
import { claudeAdapter } from "@ysa-ai/shared";

const { parseOutput } = claudeAdapter;
import type { AgentConfig } from "../config";

// Wrapper that matches the old buildClaudeCommand signature used in tests
function buildClaudeCommand(opts: {
  continueMode: boolean;
  sessionId?: string;
  refinePrompt?: string;
  allowedTools: string;
}): string[] {
  return claudeAdapter.buildCommand({
    resumeSessionId: opts.continueMode && opts.sessionId ? opts.sessionId : undefined,
    resumePrompt: opts.continueMode && opts.sessionId
      ? (opts.refinePrompt ?? "Continue from where you left off. Complete the remaining tasks for this phase.")
      : undefined,
    allowedTools: opts.allowedTools,
    maxTurns: 60,
    usePromptUrl: !opts.continueMode,
  });
}

const mockConfig: AgentConfig = {
  projectRoot: "/tmp/test-project",
  worktreePrefix: "/tmp/worktrees/",
  branchPrefix: "fix/",
  installCmd: "bun install",
  buildCmd: "bun run build",
  envFiles: [".env"],
  worktreeFiles: [],
  devServers: [],
  mcpConfig: null,
  dashboardPort: 3333,
  issuesDir: "/tmp/workflow-agent-issues",
  issueUrlTemplate: "https://gitlab.com/test/issues/{id}",
  qaEnabled: false,
  testCmd: "bun test",
  networkPolicy: "none",
};

function makeStepDef(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    slug: "analyze",
    name: "Analyze",
    toolPreset: "readonly",
    toolAllowlist: null,
    containerMode: "readonly",
    modules: [],
    promptTemplate: "# Step: {ISSUE_ID}\n\nDo the thing.",
    isLastStep: false,
    prevStepResult: null,
    ...overrides,
  };
}

// ─── composePrompt ───────────────────────────────────────────────────────

describe("composePrompt", () => {
  test("uses promptTemplate from stepDef", async () => {
    const prompt = await composePrompt(
      "analyze", "42", mockConfig, "http://localhost:3333",
      makeStepDef({ promptTemplate: "Hello issue {ISSUE_ID}" }),
    );
    expect(prompt).toContain("Hello issue 42");
  });

  test("falls back to generic prompt when template is empty", async () => {
    const prompt = await composePrompt(
      "analyze", "42", mockConfig, "http://localhost:3333",
      makeStepDef({ promptTemplate: "" }),
    );
    expect(prompt).toContain("Step: analyze");
  });

  test("substitutes all variables", async () => {
    const prompt = await composePrompt(
      "analyze", "99", mockConfig, "http://localhost:3333",
      makeStepDef({ promptTemplate: "{ISSUE_ID} {WORKTREE} {MAIN_REPO} {DASHBOARD_URL}" }),
    );
    expect(prompt).toContain("99");
    expect(prompt).toContain("/workspace");
    expect(prompt).toContain("/repo.git");
    expect(prompt).toContain("host.containers.internal:3333");
    expect(prompt).not.toContain("{ISSUE_ID}");
    expect(prompt).not.toContain("{WORKTREE}");
    expect(prompt).not.toContain("{MAIN_REPO}");
    expect(prompt).not.toContain("{DASHBOARD_URL}");
  });

  test("substitutes {PREV_STEP_RESULT} with prevStepResult", async () => {
    const prompt = await composePrompt(
      "execute", "42", mockConfig, "http://localhost:3333",
      makeStepDef({
        slug: "execute",
        promptTemplate: "Prev result: {PREV_STEP_RESULT}",
        prevStepResult: "## My Plan\n\nDo the thing.",
      }),
    );
    expect(prompt).toContain("## My Plan");
    expect(prompt).toContain("Do the thing.");
    expect(prompt).not.toContain("{PREV_STEP_RESULT}");
  });

  test("substitutes {PREV_STEP_RESULT} with empty string when null", async () => {
    const prompt = await composePrompt(
      "execute", "42", mockConfig, "http://localhost:3333",
      makeStepDef({
        slug: "execute",
        promptTemplate: "Prev: {PREV_STEP_RESULT}end",
        prevStepResult: null,
      }),
    );
    expect(prompt).toContain("Prev: end");
    expect(prompt).not.toContain("{PREV_STEP_RESULT}");
  });

  test("injects module prompts", async () => {
    const prompt = await composePrompt(
      "execute", "42", mockConfig, "http://localhost:3333",
      makeStepDef({
        slug: "execute",
        promptTemplate: "Main template.",
        modules: [
          { name: "unit_tests", prompt: "## Write Tests\n\nRun tests and report." },
        ],
      }),
    );
    expect(prompt).toContain("Main template.");
    expect(prompt).toContain("## Write Tests");
    expect(prompt).toContain("Run tests and report.");
  });

  test("injects multiple module prompts in order", async () => {
    const prompt = await composePrompt(
      "execute", "42", mockConfig, "http://localhost:3333",
      makeStepDef({
        slug: "execute",
        promptTemplate: "Main.",
        modules: [
          { name: "unit_tests", prompt: "MODULE_A" },
          { name: "manual_qa", prompt: "MODULE_B" },
        ],
      }),
    );
    const posA = prompt.indexOf("MODULE_A");
    const posB = prompt.indexOf("MODULE_B");
    expect(posA).toBeGreaterThan(-1);
    expect(posB).toBeGreaterThan(posA);
  });

  test("replaces localhost with host.containers.internal in dashboard URL", async () => {
    const prompt = await composePrompt(
      "analyze", "42", mockConfig, "http://localhost:3333",
      makeStepDef({ promptTemplate: "{DASHBOARD_URL}" }),
    );
    expect(prompt).not.toContain("localhost");
    expect(prompt).toContain("host.containers.internal");
  });
});

// ─── buildAllowedToolsFromPreset ──────────────────────────────────────────

describe("buildAllowedToolsFromPreset", () => {
  test("builtin presets with no allowlist return empty string (all tools)", () => {
    expect(buildAllowedToolsFromPreset("readonly", null)).toBe("");
    expect(buildAllowedToolsFromPreset("readwrite", null)).toBe("");
    expect(buildAllowedToolsFromPreset("custom", null)).toBe("");
  });

  test("custom allowlist is passed through as-is", () => {
    expect(buildAllowedToolsFromPreset("readonly", ["WebSearch", "WebFetch"])).toBe("WebSearch,WebFetch");
  });

  test("empty allowlist returns empty string", () => {
    expect(buildAllowedToolsFromPreset("readonly", [])).toBe("");
  });

  test("allowlist with mcp sentinel is passed through", () => {
    const tools = buildAllowedToolsFromPreset("readonly", ["Read", "mcp__*"]);
    expect(tools).toBe("Read,mcp__*");
  });
});

// ─── buildClaudeCommand ──────────────────────────────────────────────────

describe("buildClaudeCommand", () => {
  test("fresh mode returns args without -p (prompt fetched by sandbox-run.sh)", () => {
    const args = buildClaudeCommand({
      continueMode: false,
      allowedTools: "Read,Glob",
    });
    expect(args).not.toContain("-p");
    expect(args).not.toContain("claude");
    expect(args.some((s) => s.includes("curl"))).toBe(false);
  });

  test("fresh mode includes standard flags", () => {
    const args = buildClaudeCommand({
      continueMode: false,
      allowedTools: "Read,Glob",
    });
    expect(args).toContain("--tools");
    expect(args).toContain("Read,Glob");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--max-turns");
    expect(args).toContain("60");
  });

  test("fresh mode includes --add-dir for workspace only", () => {
    const args = buildClaudeCommand({
      continueMode: false,
      allowedTools: "Read",
    });
    const addDirIndices = args.reduce<number[]>(
      (acc, v, i) => (v === "--add-dir" ? [...acc, i] : acc),
      [],
    );
    expect(addDirIndices.length).toBe(1);
    expect(args[addDirIndices[0] + 1]).toBe("/workspace");
  });

  test("continue mode includes --resume and session_id", () => {
    const args = buildClaudeCommand({
      continueMode: true,
      sessionId: "sess-abc-123",
      allowedTools: "Read,Edit",
    });
    expect(args).toContain("--resume");
    expect(args).toContain("sess-abc-123");
    expect(args).toContain("-p");
    expect(args.some((s) => s.includes("Continue from where"))).toBe(true);
  });

  test("continue mode does not contain curl", () => {
    const args = buildClaudeCommand({
      continueMode: true,
      sessionId: "sess-abc-123",
      allowedTools: "Read,Edit",
    });
    expect(args.some((s) => s.includes("curl"))).toBe(false);
  });
});

// ─── parseOutput ─────────────────────────────────────────────────────────

describe("parseOutput", () => {
  test("extracts session_id from system line", () => {
    const log = `{"type":"system","session_id":"sess-xyz-789","tools":[]}\n{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}\n`;
    const result = parseOutput(log);
    expect(result.sessionId).toBe("sess-xyz-789");
    expect(result.maxTurnsReached).toBe(false);
    expect(result.lastError).toBe("Hello");
  });

  test("detects error_max_turns", () => {
    const log = `{"type":"system","session_id":"sess-1"}\n{"type":"result","subtype":"error_max_turns"}\n`;
    const result = parseOutput(log);
    expect(result.maxTurnsReached).toBe(true);
    expect(result.sessionId).toBe("sess-1");
  });

  test("extracts last assistant message as error context", () => {
    const log = [
      '{"type":"system","session_id":"s1"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"First message"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Last error message here"}]}}',
      "",
    ].join("\n");
    const result = parseOutput(log);
    expect(result.lastError).toBe("Last error message here");
  });

  test("returns null session_id when no system line present", () => {
    const log = `{"type":"assistant","message":{"content":[{"type":"text","text":"No system"}]}}\n`;
    const result = parseOutput(log);
    expect(result.sessionId).toBeNull();
  });

  test("handles empty log gracefully", () => {
    const result = parseOutput("");
    expect(result.sessionId).toBeNull();
    expect(result.maxTurnsReached).toBe(false);
    expect(result.lastError).toBeNull();
  });

  test("handles malformed JSON lines gracefully", () => {
    const log = `not json\n{"type":"system","session_id":"sess-ok"}\nalso not json\n`;
    const result = parseOutput(log);
    expect(result.sessionId).toBe("sess-ok");
  });

  test("skips lines before skipLinesBefore for max-turns detection", () => {
    const log = [
      '{"type":"result","subtype":"error_max_turns"}',
      '{"type":"system","session_id":"sess-2"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"New run"}]}}',
      "",
    ].join("\n");
    const result = parseOutput(log, 1);
    expect(result.maxTurnsReached).toBe(false);
    expect(result.sessionId).toBe("sess-2");
  });

  test("still finds session_id from before skipLinesBefore", () => {
    const log = [
      '{"type":"system","session_id":"sess-old"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"new content"}]}}',
      "",
    ].join("\n");
    const result = parseOutput(log, 1);
    expect(result.sessionId).toBe("sess-old");
  });
});
