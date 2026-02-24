# Backend API Workflow

Backend workflow supports only API discovery and API calling.

## Rules

- If API contract is unclear, ask the user before making assumptions.
- All command usage lives in `.agent/docs/API_SCRIPT_USAGE_GUIDE.md`.

## API Toolkit Context

- Use prebuilt binaries directly:
  - `./.agent/scripts/api` for OpenAPI discovery.
  - `./.agent/scripts/acurl` for guarded API execution.
- Do not change toolkit/config unless user explicitly asks.
