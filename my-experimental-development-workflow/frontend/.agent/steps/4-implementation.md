# Step 4: Implementation

## Prerequisites

Plan at `.agent/plans/PLAN_<feature>.md`. Missing → ask user.

With Step 3: skip plan approval only if ≤8 files and ≤2 decisions. Otherwise present plan; wait.

## Procedure

1. Read plan + reference module identified in it.
2. Read project patterns (Resources in `Agent.md`).
3. Plan has `## Phases` → execute one phase at a time:
   - Complete all files in phase.
   - Run lint/build. Fix before next phase.
   - Git commit with phase label.
4. No phases → implement file by file per plan.
5. Implement only what's in plan.

## Output

```
## Implementation Summary: <Feature>

### Files Created
- path — description

### Files Modified
- path — what changed

### Notes
- Deviations from plan (if any) and why
```

## Boundaries

- No browser tests (Step 5).
- No API discovery/testing (Steps 1-2).
