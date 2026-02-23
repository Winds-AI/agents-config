# API Scripts

Setup: `source .agent/scripts/api-env.sh` (once per session — loads config, adds scripts to PATH)

## curl wrapper

```bash
curl "/bandar-admin/discounts"
curl -X POST -d '{"code":"X"}' "/bandar-admin/discounts"
```

Locked to `config.toml` defaults — no custom Authorization headers, no URLs outside API_BASE.

## api CLI (OpenAPI discovery)

```bash
api search <keyword>                  # find endpoints
api detail <path> [method]            # full endpoint details + resolved schemas
api schema <name>                     # inspect a component schema
api paths                             # list all paths
api tags                              # list tags with endpoint counts
api refresh                           # re-download spec
```

## Response validation

```bash
curl -s "<path>" | api validate <path> <METHOD> [--status 200]
```

Output: `+` match, `x` mismatch, `?` nullable warning, `~` extra field.

## Workflow

1. `api search` → 2. `api detail` → 3. `api schema` → 4. `curl | api validate`
