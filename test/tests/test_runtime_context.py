from __future__ import annotations

from pathlib import Path

from agent_api.cli import load_runtime_context
from agent_api.session import set_session_token_name


def write_config(path: Path) -> None:
    path.write_text(
        """
active_project = "myproject"
active_env = "dev"
default_token = "dev_superuser"

[projects.myproject.envs.dev]
api_base = "https://api.dev.local"
api_mode = "safe-updates"
openapi_url = "https://api.dev.local/openapi.json"

[projects.myproject.envs.dev.tokens]
dev_superuser = "token-a"
dev_user = "token-b"
""".strip()
        + "\n",
        encoding="utf-8",
    )


def test_runtime_context_uses_default_token(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    write_config(config_path)
    context = load_runtime_context(config_path)
    assert context.token_name == "dev_superuser"
    assert context.token_value == "token-a"


def test_runtime_context_uses_session_token_when_available(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    write_config(config_path)
    set_session_token_name(tmp_path, "dev_user")
    context = load_runtime_context(config_path)
    assert context.token_name == "dev_user"
    assert context.token_value == "token-b"


def test_runtime_context_cli_override_wins(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    write_config(config_path)
    set_session_token_name(tmp_path, "dev_user")
    context = load_runtime_context(config_path, override_token_name="dev_superuser")
    assert context.token_name == "dev_superuser"
    assert context.token_value == "token-a"
