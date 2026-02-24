from __future__ import annotations

from pathlib import Path
import json

from .errors import AgentApiError


def _session_dir(config_dir: Path) -> Path:
    return config_dir / ".agent-api"


def _session_file(config_dir: Path) -> Path:
    return _session_dir(config_dir) / "session.json"


def get_session_token_name(config_dir: Path) -> str | None:
    path = _session_file(config_dir)
    if not path.exists():
        return None

    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    token_name = content.get("token_name")
    if isinstance(token_name, str) and token_name.strip():
        return token_name
    return None


def set_session_token_name(config_dir: Path, token_name: str) -> Path:
    if not token_name.strip():
        raise AgentApiError("ERR_TOKEN_NOT_FOUND", "Token name cannot be empty.")

    directory = _session_dir(config_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = _session_file(config_dir)
    payload = {"token_name": token_name}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path
