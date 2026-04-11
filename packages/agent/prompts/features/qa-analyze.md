## QA Test Criteria

After submitting the plan, you must also submit QA criteria to the dashboard API using curl:

```bash
curl -s -X POST {DASHBOARD_URL}/api/tasks/{ISSUE_ID}/qa-criteria \
  -H "Content-Type: application/json" \
  --data-binary @- <<'QA'
{
  "criteria": [
    {
      "id": "ut-1",
      "type": "unit",
      "description": "Description of what the unit test validates",
      "status": "pending",
      "details": null
    },
    {
      "id": "man-1",
      "type": "manual",
      "description": "- Step 1 of the manual verification\n- Step 2\n- What to check",
      "status": "pending",
      "details": null
    }
  ]
}
QA
```

You MUST use this curl command to submit the QA criteria. Do NOT write qa-criteria.json to the filesystem.

This defines what needs to be tested to validate the issue is resolved. Each criterion represents a specific check — some will be automated with unit tests, others require manual or integration verification.

### Types

- **unit** — Automated test that will be written and run during execution. Use for logic, validation, data transformations, API behavior.
- **manual** — Any check that requires human verification: running the app, browser testing, visual checks, user flows, cross-module behavior. This covers everything that isn't a unit test.

### Description Formatting

When a criterion involves multiple steps or checks, use bullet points with `- ` prefix on each line. Each line should be a distinct step or assertion prefixed with `- `. This makes the test checklist scannable.

### Guidelines

- Include unit test criteria for all testable logic changes in the plan
- Add manual criteria for verifications that require running the app or human eyes
- If the issue is purely cosmetic (CSS-only, copy changes), use manual criteria only — no forced unit tests
- **Keep it minimal** — only the essential tests needed to confirm the fix works. Do NOT generate redundant or overlapping criteria. If one manual test already covers a scenario, don't create another that tests the same thing with slight variations.
- Typically: a few unit tests for the core logic + 1-2 manual tests for end-to-end verification. That's it.
- Each criterion should be specific and actionable — someone should know exactly what to check
- Use sequential IDs per type: ut-1, ut-2, ... / man-1, man-2, ...
- Also include a "## QA Test Criteria" section in the plan listing these criteria in human-readable form
