# API Scripts

Setup: `source .agent/scripts/api-env.sh` (once per session — loads config, adds scripts to PATH)

## curl wrapper

curl "/bandar-admin/discounts"
curl -X POST -d '{"code":"X"}' "/bandar-admin/discounts"

## api CLI (OpenAPI discovery)

api search <keyword>                  # find endpoints
api detail <path> [method]            # full endpoint details + resolved schemas
api schema <name>                     # inspect a component schema
api example <path> [method]           # generate ready-to-run curl command
api paths                             # list all paths
api tags                              # list tags with endpoint counts
api status                            # show active project/env/token/spec state
api refresh                           # re-download spec

## Response validation
curl -s "<path>" | api validate <path> <METHOD> [--status 200]

Output: `+` match, `x` mismatch, `?` nullable warning, `~` extra field.

## Workflow

1. api search
2. api detail
3. api example
4. curl | api validate
