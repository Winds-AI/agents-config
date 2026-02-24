# Agent API Toolkit (v1)

Minimal CLI pair for HITL API workflows:
- `api` for OpenAPI discovery/inspection
- `acurl` for config-aware API execution with safety modes

## Config

Copy `config.example.toml` to `config.toml` and fill values.

Required keys used by the tools:
- `active_project`
- `active_env`
- `default_token`
- `agent_marker`
- `strict` (true/false)
- `projects.<project>.envs.<env>.api_base`
- `projects.<project>.envs.<env>.api_mode`
- `projects.<project>.envs.<env>.openapi_url`
- `projects.<project>.envs.<env>.tokens.<name>`

## Build (Go)

```bash
go mod tidy
go build -o api ./toolkit/api.go ./toolkit/shared.go
go build -o acurl ./toolkit/acurl.go ./toolkit/shared.go
```

## Commands

### Find endpoints
```bash
./api find activity
./api find "activity list" --method GET
```

### Show endpoint details
```bash
./api show listActivities
./api show "GET /bandar-admin/activities"
```

### Call API with injected base URL + token
```bash
./acurl /bandar-admin/activities
./acurl GET /bandar-admin/activities?page=1&limit=10
./acurl PATCH /bandar-admin/activities/{id}/status -d '{"note":"[agent-test]"}'
```

`acurl` output is backend response body only, compacted when JSON.

## Safety modes (`api_mode`)

- `read-only`: allows `GET` only
- `safe-updates`: allows `GET, POST, PUT, PATCH`
  - for `POST/PUT/PATCH`, request body must contain `agent_marker`
- `full-access`: allows all methods

## Strict OpenAPI validation (`strict`)

When `strict = true`, `acurl` validates before request execution:
- method+path must exist in OpenAPI
- required path params must be present
- required query params must be present

## Exit codes

- `0` success
- `1` unexpected/internal/transport error
- `2` config error
- `3` token error
- `4` OpenAPI fetch failed
- `5` OpenAPI parse failed
- `6` endpoint not found (`api show`)
- `7` method blocked by `api_mode`
- `8` missing `agent_marker` in safe-updates writes
- `9` request/argument build error
- `10` HTTP request returned 4xx/5xx
