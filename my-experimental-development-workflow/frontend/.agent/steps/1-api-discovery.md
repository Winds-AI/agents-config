# Step 1: API Discovery

## Procedure

1. From project root, source the API environment: `source .agent/scripts/api-env.sh`
2. Search for relevant endpoints: `api search <keyword>`
   - One broad query first (e.g., `api search certificate`)
   - Re-search only if 0 matches or specific endpoint missing
3. Drill into each relevant endpoint: `api detail <path> [method]`
   - Get full parameters, request body, response schemas
4. Inspect specific schemas if needed: `api schema <SchemaName>`
5. Scan existing API service files for overlap (see project patterns for API layer paths).
6. Scan existing route constants for overlap.

## Output

```
## API Discovery Report: <Feature>

### Endpoints Found

| # | Method | Path | Description | Status |
|---|--------|------|-------------|--------|
| 1 | GET | /path | ... | New / Existing / Updated |

### Endpoint Details

#### 1. METHOD /path
- Request: params/body shape (include param *location*)
- Response: response shape
- Notes: discrepancies, name changes, deprecations

### Existing Codebase References
- Files integrating related APIs: [list]
- Route constants defined: [list]

### Risk Notes
- [workaround or mismatch to double-check later]
```

## Boundaries

- No API calls (Step 2).
- No plan or implementation.
