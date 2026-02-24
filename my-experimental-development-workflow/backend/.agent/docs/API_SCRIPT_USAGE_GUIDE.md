# API Toolkit (test3)

Toolkit location: `.agent/scripts`

## Commands

OpenAPI discovery:

```bash
./api find activity
./api find "activity list" --method GET
./api show listActivities
./api show "GET /bandar-admin/activities"
```

API execution:

```bash
./acurl /bandar-admin/activities
./acurl GET /bandar-admin/activities?page=1&limit=10
./acurl PATCH /bandar-admin/activities/{id}/status -d '{"note":"[agent-test]"}'
```

## Guardrails

- `read-only`: allows `GET` only.
- `safe-updates`: allows `GET, POST, PUT, PATCH`; write bodies must contain `agent_marker`.
- `full-access`: allows all methods.
- If `strict = true`, `acurl` validates method/path and required params against OpenAPI before execution.
