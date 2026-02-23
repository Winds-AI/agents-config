# Step 5: Testing

**User-flow verifications in headless browser**, not unit tests.

## Procedure

1. Get test cases from:
   - Plan's `## Test Cases` section (if exists), OR
   - Derive from implementation: cover all happy-path user flows.
2. Per test case, use `agent-browser` skill:
   - Navigate to page.
   - Perform action (click, fill, submit).
   - Verify outcome (element visible, toast shown, data updated).
3. Record: Pass / Fail / Blocked.

## Output

```
## Test Results: <Feature>

| # | Test Case | Result | Notes |
|---|-----------|--------|-------|
| 1 | Load page, verify data | Pass | — |
| 2 | Submit form | Fail | Toast missing |

### Failure Details
#### Test 2
- Expected: Success toast
- Actual: No toast, data saved
```

## Boundaries

- No code modifications. Report issues only.
- No curl API calls.
