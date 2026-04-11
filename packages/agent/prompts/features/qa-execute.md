## QA: Write and Run Tests

The QA criteria below were defined during the analysis phase. You must write and run unit tests to validate the implementation.

### Instructions

1. **Write unit tests FIRST** — Before or alongside implementing the code changes, write unit tests for all criteria with `type: "unit"`. Follow TDD when it makes sense.

2. **Run the tests** — Execute the test suite: `{TEST_CMD}`

3. **Update results** — After running tests, submit the updated QA criteria to the dashboard API:

```bash
curl -s -X POST {DASHBOARD_URL}/api/tasks/{ISSUE_ID}/qa-criteria \
  -H "Content-Type: application/json" \
  --data-binary @- <<'QA'
{
  "criteria": [
    ... updated criteria with status and details ...
  ]
}
QA
```

   - For each `unit` criterion: set `status` to `"passed"` or `"failed"`
   - Add test output or error details in the `details` field
   - Leave `manual` criteria as `"pending"` — those are verified by humans

You MUST use this curl command to submit the updated QA criteria. Do NOT write qa-criteria.json to the filesystem.

{TEST_INSTRUCTIONS}

### QA Criteria
