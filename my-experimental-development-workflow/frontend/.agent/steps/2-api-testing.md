# Step 2: API Testing

## Goal

Validate behavior (spec drift + parameter acceptance), not just status codes.

## Safe-Updates Rules

`api_mode=safe-updates`: mutating endpoints allowed with constraints:

1. Tag test data `[agent-test]` in human-visible field (`title`, `name`, `description`, `notes`) for cleanup.
2. Updates minimal: only `[agent-test]` marker or smallest required field. No overwriting unrelated values.
3. Create allowed: only `[agent-test] ...` records. Record IDs for cleanup.
4. Deletes/unassigns NOT allowed in `safe-updates` (toolkit guardrail).
   - `api_mode=full-access` (explicit user enable): `DELETE` only what you created/assigned in current run.
5. Prefer non-mutating validation: invalid payloads/IDs to confirm validation/response shapes.

## Procedure

1. From project root, use `./.agent/scripts/acurl` for requests.
2. Per endpoint: validate happy path + 1 contract edge:
   ```bash
   # acurl reads .agent/scripts/config.toml
   ./.agent/scripts/acurl GET "/<path>"
   ```
3. Record: HTTP status, response structure, field names/types.
4. Compare against OpenAPI spec from Step 1.
5. Contract edge checks (most relevant per endpoint):
   - Missing required field (expect 400) or unknown field/param (confirm reject vs ignore).
   - OpenAPI defines no query params → treat extra query params as suspicious; raise question in Step 3.
6. Blocked by `api_mode` → document unvalidated; raise question (no bypass).

## Output

```
## API Validation Report: <Feature>

### Results

| # | Endpoint | Status | Result | Notes |
|---|----------|--------|--------|-------|
| 1 | GET /path | 200 | Pass | — |
| 2 | POST /path | 400 | Warn | Missing field X |

### Response Samples

#### 1. GET /path
- Status: 200
- Response: { field1: type, ... }
- Spec match: Yes/No — details

### Discrepancies
- [list]

### Contract Questions Raised
- [e.g., backend rejects unknown query params; remove from frontend?]
```

## Boundaries

- No plan or implementation.
