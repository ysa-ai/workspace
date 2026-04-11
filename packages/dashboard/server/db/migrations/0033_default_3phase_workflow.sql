WITH wf AS (
  INSERT INTO workflows (name, description, is_builtin, org_id)
  VALUES ('Default', 'Standard 3-phase workflow: Analyze → Execute → Finalize', true, NULL)
  ON CONFLICT DO NOTHING
  RETURNING id
),
wf_id AS (
  SELECT id FROM wf
  UNION ALL
  SELECT id FROM workflows WHERE name = 'Default' AND is_builtin = true
  LIMIT 1
),
analyze_step AS (
  INSERT INTO workflow_steps (workflow_id, name, slug, position, prompt_template, tool_preset, container_mode, modules, auto_advance, network_policy)
  SELECT id, 'Analyze', 'analyze', 0,
    'You are analyzing a {ISSUE_SOURCE_NAME} issue to produce an implementation plan. Your goal is to deeply understand the issue and the relevant codebase, then write a clear, actionable plan.

## Steps

1. **Explore the codebase** — Identify the files, modules, and patterns relevant to the issue in the worktree. Understand the existing architecture before proposing changes. Look at related tests, types, and dependencies.

2. **Write the plan** — Follow the plan module instructions below. The plan must be detailed enough that someone can execute it without re-reading the issue. Reference specific file paths, function names, and line numbers when possible. If the issue is ambiguous, make reasonable assumptions and document them in Notes.

## Rules

- If the issue is ambiguous, make reasonable assumptions and document them in the plan',
    'readonly', 'readonly',
    '[{"name":"fetch_issue","prompt":""},{"name":"__prompt__","prompt":""},{"name":"plan","prompt":"Your plan should include:\n- **Title**: A concise title summarising the work\n- **Summary**: Brief description of the approach and why it was chosen\n- **Implementation steps**: Numbered, concrete steps\n- **Risks**: Edge cases, dependencies, or open questions"},{"name":"manual_qa","prompt":"Focus on user-facing behaviour and acceptance criteria from the issue."}]',
    false, 'strict'
  FROM wf_id
  RETURNING id
),
execute_step AS (
  INSERT INTO workflow_steps (workflow_id, name, slug, position, prompt_template, tool_preset, container_mode, modules, auto_advance, network_policy)
  SELECT id, 'Execute', 'execute', 1,
    '# Phase 2: Execute Plan for Issue #{ISSUE_ID}

You are implementing the approved plan for issue #{ISSUE_ID}. Follow the plan precisely, make the code changes, and deliver a {PR_TERM}.

## Steps

1. **Read the plan** — Review the approved plan appended below carefully before starting.

2. **Implement** — Make all code changes described in the plan. Work ONLY in the worktree directory. The worktree and dependencies are already set up.

3. **Verify** — Run any relevant build or lint commands to ensure the code compiles and passes basic checks.

## Rules

- Follow the plan — do not add scope beyond what was planned
- Write clean, idiomatic code matching the existing codebase style
- If something in the plan doesn''t work, adapt and document the deviation in result notes',
    'readwrite', 'readwrite',
    '[{"name":"__prompt__","prompt":""},{"name":"delivery","prompt":""},{"name":"unit_tests","prompt":""}]',
    false, 'strict'
  FROM wf_id
  RETURNING id
),
finalize_step AS (
  INSERT INTO workflow_steps (workflow_id, name, slug, position, prompt_template, tool_preset, container_mode, modules, auto_advance, network_policy)
  SELECT id, 'Finalize', 'finalize', 2,
    '# Phase 3: Finalize Issue #{ISSUE_ID}

You are finalizing the work done for issue #{ISSUE_ID}. Review the execution results and complete the steps defined by the modules below.

## Steps

1. **Review results** — Read the execution results appended below. Check the {PR_TERM_SHORT} URL, test status, and any notes.

2. **Complete each module** — Follow the module instructions and execution order below.',
    'post-execution', 'readwrite',
    '[{"name":"__prompt__","prompt":""},{"name":"issue_update","prompt":"","config":{"postComment":true,"closeIssue":true,"addLabels":[],"removeLabels":[]}}]',
    true, 'strict'
  FROM wf_id
  RETURNING id
)
INSERT INTO workflow_transitions (from_step_id, to_step_id, label, is_default, position)
SELECT a.id, e.id, '→ Execute', true, 0 FROM analyze_step a, execute_step e
UNION ALL
SELECT e.id, f.id, '→ Finalize', true, 0 FROM execute_step e, finalize_step f
UNION ALL
SELECT f.id, NULL, NULL, true, 0 FROM finalize_step f;
