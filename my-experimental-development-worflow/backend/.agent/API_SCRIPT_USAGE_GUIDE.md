# API Testing

```bash
source .agent/api-env.sh

# GET
curl "$API_BASE/bandar-admin/activities"

# POST
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}' \
  "$API_BASE/bandar-admin/activities"

# PATCH
curl -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"status": "inactive"}' \
  "$API_BASE/bandar-admin/activities/{id}"

# DELETE
curl -X DELETE "$API_BASE/bandar-admin/activities/{id}"
```

## Config

Copy and edit:

```toml
# .agent/scripts/config.toml
active_project = "bandar"
active_env = "dev"
default_token = "dev_superuser"

[projects.bandar.envs.dev]
api_base = "<your-dev-api-base-url>"
api_mode = "safe-updates"
openapi_url = "<your-dev-openapi-json-url>"

[projects.bandar.envs.dev.tokens]
dev_superuser = "<your-jwt-token-here>"
```
