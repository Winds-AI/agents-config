# API Testing

```bash
source .agent/api-env.sh

# GET
API_TOKEN_NAME=dev-admin curl "$API_BASE/bandar-admin/activities"

# POST
API_TOKEN_NAME=dev-admin curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}' \
  "$API_BASE/bandar-admin/activities"

# PATCH
API_TOKEN_NAME=dev-admin curl -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"status": "inactive"}' \
  "$API_BASE/bandar-admin/activities/{id}"

# DELETE
API_TOKEN_NAME=dev-admin curl -X DELETE "$API_BASE/bandar-admin/activities/{id}"
```

## tokens.toml format

```toml
[dev-admin]
token = "eyJhbGc..."
```
