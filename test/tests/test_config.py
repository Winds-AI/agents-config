from __future__ import annotations

from pathlib import Path

import pytest

from agent_api.config import load_config
from agent_api.errors import AgentApiError


def write_config(path: Path, *, mode: str = "safe-updates", default_token: str = "dev_superuser") -> None:
    path.write_text(
        f"""
active_project = "myproject"
active_env = "dev"
default_token = "{default_token}"

[projects.myproject.envs.dev]
api_base = "https://api.dev.local"
api_mode = "{mode}"
openapi_url = "https://api.dev.local/openapi.json"

[projects.myproject.envs.dev.tokens]
dev_superuser = "token-a"
dev_user = "token-b"
""".strip()
        + "\n",
        encoding="utf-8",
    )


def test_load_config_success(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    write_config(config_path)

    config = load_config(config_path)
    assert config.active_project == "myproject"
    assert config.active_env == "dev"
    assert config.env_config.api_mode == "safe-updates"
    assert "dev_superuser" in config.env_config.tokens


def test_load_config_invalid_mode(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    write_config(config_path, mode="unsafe")

    with pytest.raises(AgentApiError) as exc:
        load_config(config_path)

    assert exc.value.code == "ERR_CONTEXT_INVALID"
    assert "Invalid api_mode" in exc.value.message


def test_load_config_default_token_must_exist(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    write_config(config_path, default_token="missing_token")

    with pytest.raises(AgentApiError) as exc:
        load_config(config_path)

    assert exc.value.code == "ERR_CONTEXT_INVALID"
    assert "default_token" in exc.value.message
