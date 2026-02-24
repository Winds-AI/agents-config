# Agent API Toolkit

Use prebuilt binaries in this folder:
- `./api`
- `./acurl`

Canonical usage and guardrails:
- `../docs/API_SCRIPT_USAGE_GUIDE.md`

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
