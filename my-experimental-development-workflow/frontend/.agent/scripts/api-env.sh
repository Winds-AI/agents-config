#!/usr/bin/env bash
# Source once: source .agent/scripts/api-env.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export API_CONFIG_FILE="$DIR/config.toml"

# Cache exports by absolute config path + file metadata to avoid cross-project cache collisions.
_CACHE_KEY=$(python3 - "$API_CONFIG_FILE" <<'PY'
import hashlib
import os
import sys

cfg_path = os.path.abspath(sys.argv[1])
try:
    st = os.stat(cfg_path)
except OSError as e:
    raise SystemExit(f"Cannot read config.toml at {cfg_path}: {e}")

fingerprint = f"{cfg_path}|{st.st_mtime_ns}|{st.st_size}".encode("utf-8")
print(hashlib.sha256(fingerprint).hexdigest()[:16])
PY
)
if [[ $? -ne 0 ]]; then
    unset _CACHE_KEY
    return 1
fi
_CACHE_FILE="/tmp/.agent-api-env-${_CACHE_KEY}.sh"
unset _CACHE_KEY

if [[ -f "$_CACHE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$_CACHE_FILE"
else
    # Resolve defaults from config.toml.
    # IMPORTANT: We intentionally set these here to prevent per-call overrides.
    _EXPORTS=$(python3 - "$API_CONFIG_FILE" <<'PY'
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

tokens = env_cfg.get("tokens") or {}
default_token_key = cfg.get("default_token") or next(iter(tokens), None)
if not default_token_key or default_token_key not in tokens:
    raise SystemExit("Missing default_token (or projects.<project>.envs.<env>.tokens empty) in config.toml")

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
)
    if [[ $? -ne 0 ]]; then
        echo "$_EXPORTS" >&2
        unset _CACHE_FILE _EXPORTS
        return 1
    fi
    echo "$_EXPORTS" > "$_CACHE_FILE"
    eval "$_EXPORTS"
fi

unset _CACHE_FILE _EXPORTS

# Add wrappers (this folder) to PATH.
export PATH="$DIR:$PATH"
