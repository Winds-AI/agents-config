from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import tomllib

from .errors import AgentApiError

VALID_MODES = {"read-only", "safe-updates", "full-access"}


@dataclass(frozen=True)
class EnvConfig:
    project: str
    env: str
    api_base: str
    api_mode: str
    openapi_url: str
    tokens: dict[str, str]


@dataclass(frozen=True)
class AppConfig:
    path: Path
    active_project: str
    active_env: str
    default_token: str
    env_config: EnvConfig


def _normalize_path(config_path: str | Path | None) -> Path:
    if config_path is not None:
        path = Path(config_path).expanduser().resolve()
        if not path.exists():
            raise AgentApiError(
                "ERR_CONTEXT_INVALID",
                f"Config file not found: {path}",
                "Provide --config pointing to a valid TOML config file.",
            )
        return path

    cwd = Path.cwd()
    preferred = cwd / "config.toml"
    if preferred.exists():
        return preferred.resolve()

    fallback = cwd / "config.example.toml"
    if fallback.exists():
        return fallback.resolve()

    raise AgentApiError(
        "ERR_CONTEXT_INVALID",
        "No config file found.",
        "Create config.toml or pass --config with a valid config file path.",
    )


def _require_string(data: dict[str, Any], key: str, error_code: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise AgentApiError(error_code, f"Missing or invalid '{key}' in config.")
    return value


def load_config(config_path: str | Path | None = None) -> AppConfig:
    path = _normalize_path(config_path)
    with path.open("rb") as fh:
        data = tomllib.load(fh)

    active_project = _require_string(data, "active_project", "ERR_CONTEXT_INVALID")
    active_env = _require_string(data, "active_env", "ERR_CONTEXT_INVALID")
    default_token = _require_string(data, "default_token", "ERR_CONTEXT_INVALID")

    projects = data.get("projects")
    if not isinstance(projects, dict):
        raise AgentApiError("ERR_CONTEXT_INVALID", "Missing [projects] table in config.")

    project_entry = projects.get(active_project)
    if not isinstance(project_entry, dict):
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            f"Active project '{active_project}' not found in [projects].",
        )

    envs = project_entry.get("envs")
    if not isinstance(envs, dict):
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            f"Missing env definitions for project '{active_project}'.",
        )

    env_entry = envs.get(active_env)
    if not isinstance(env_entry, dict):
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            f"Active env '{active_env}' not found under project '{active_project}'.",
        )

    api_base = _require_string(env_entry, "api_base", "ERR_CONTEXT_INVALID")
    api_mode = _require_string(env_entry, "api_mode", "ERR_CONTEXT_INVALID")
    openapi_url = _require_string(env_entry, "openapi_url", "ERR_CONTEXT_INVALID")

    if api_mode not in VALID_MODES:
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            f"Invalid api_mode '{api_mode}'. Expected one of: {', '.join(sorted(VALID_MODES))}.",
        )

    tokens = env_entry.get("tokens")
    if not isinstance(tokens, dict) or not tokens:
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            f"Missing [projects.{active_project}.envs.{active_env}.tokens] table.",
        )

    normalized_tokens: dict[str, str] = {}
    for name, value in tokens.items():
        if not isinstance(name, str) or not isinstance(value, str) or not value.strip():
            raise AgentApiError(
                "ERR_CONTEXT_INVALID",
                f"Invalid token entry in [projects.{active_project}.envs.{active_env}.tokens].",
            )
        normalized_tokens[name] = value

    if default_token not in normalized_tokens:
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            f"default_token '{default_token}' is not defined in active env token list.",
        )

    env_config = EnvConfig(
        project=active_project,
        env=active_env,
        api_base=api_base,
        api_mode=api_mode,
        openapi_url=openapi_url,
        tokens=normalized_tokens,
    )

    return AppConfig(
        path=path,
        active_project=active_project,
        active_env=active_env,
        default_token=default_token,
        env_config=env_config,
    )
