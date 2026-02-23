#!/usr/bin/env bash
# Source once: source .agent/scripts/api-env.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export API_CONFIG_FILE="$DIR/config.toml"

# Resolve defaults from config.toml.
# IMPORTANT: We intentionally set these here to prevent per-call overrides.
eval "$(
  python3 - "$API_CONFIG_FILE" <<'PY'
import shlex
import sys
from pathlib import Path

import tomllib

cfg_path = Path(sys.argv[1])
cfg = tomllib.loads(cfg_path.read_text(encoding="utf-8"))

projects = cfg.get("projects") or {}
active_project = cfg.get("active_project") or next(iter(projects), None)
if not active_project or active_project not in projects:
    raise SystemExit("Invalid or missing active_project in config.toml")

proj = projects[active_project] or {}
envs = proj.get("envs") or {}
active_env = cfg.get("active_env") or next(iter(envs), None)
if not active_env or active_env not in envs:
    raise SystemExit("Invalid or missing active_env in config.toml")

env_cfg = envs[active_env] or {}
api_base = env_cfg.get("api_base")
api_mode = env_cfg.get("api_mode", "safe-updates")
if not api_base:
    raise SystemExit("Missing projects.<project>.envs.<env>.api_base in config.toml")

tokens = proj.get("tokens") or {}
default_token_key = proj.get("default_token") or next(iter(tokens), None)
if not default_token_key or default_token_key not in tokens:
    raise SystemExit("Missing projects.<project>.default_token (or tokens empty) in config.toml")

token_value = tokens.get(default_token_key)
if not token_value:
    raise SystemExit("Default token value is empty in config.toml")

def ex(k: str, v: str) -> str:
    return f"export {k}={shlex.quote(str(v))}"

print(ex("API_PROJECT", active_project))
print(ex("API_ENV", active_env))
print(ex("API_BASE", api_base))
print(ex("API_MODE", api_mode))
print(ex("API_TOKEN_KEY", default_token_key))
print(ex("API_TOKEN_VALUE", token_value))
PY
)"

# Add wrappers (this folder) to PATH.
export PATH="$DIR:$PATH"
