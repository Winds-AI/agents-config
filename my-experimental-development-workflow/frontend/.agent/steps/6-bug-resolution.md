# Step 6: Bug / Issue Resolution

## Procedure

1. Get issue details:
   - ID provided → fetch via `redmine_getIssue`.
   - Title/description provided → use directly.
2. Search codebase for related code paths.
3. API-related → use `./.agent/scripts/api` (discovery) and `./.agent/scripts/acurl` (calls).
4. Framework/library-related → web search.
5. Identify root cause. Apply minimal fix.

## Output

```
## Bug Resolution: <Issue ID/Title>

### Root Cause
- [explanation]

### Fix Applied
- File: path — what changed

### Verification
- [manual steps or suggest Step 5]
```

## Boundaries

- Fix specific issue only. No refactoring, no unrelated changes.
