# agent-api (V1)

Policy-enforced CLI for agent API discovery and calls using the existing TOML format.

## Core Rules

1. `active_project` and `active_env` come from config and are not switchable by command.
2. Token switching is allowed with `token use <token_name>` or per call using `--token`.
3. Safety mode comes from config (`read-only`, `safe-updates`, `full-access`).

## Config

Copy and fill:

```bash
cp config.example.toml config.toml
```

The CLI reads:

1. `./config.toml` if present
2. Otherwise `./config.example.toml`

You can override with `--config <path>`.

## Commands

```bash
./agent-api context show
./agent-api token list
./agent-api token use dev_user
./agent-api spec pull
./agent-api spec search "create product"
./agent-api spec show POST /products
./agent-api call -X GET /products
./agent-api call -X POST /products --json '{"name":"Widget [agent-test]"}'
./agent-api call -X DELETE /products/123 --confirm-delete
```

## Safety Enforcement

1. `read-only`: only `GET`, `HEAD`, `OPTIONS`.
2. `safe-updates`: allows `POST`, `PUT`, `PATCH`; blocks `DELETE`; write JSON must include `[agent-test]` in all string fields.
3. `full-access`: allows all methods; `DELETE` requires `--confirm-delete`.

## Dev

Run tests:

```bash
go test ./...
```
