from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json
import time
from urllib import error, request

from .config import AppConfig
from .errors import AgentApiError

OPENAPI_METHODS = {"get", "head", "options", "post", "put", "patch", "delete"}
DEFAULT_CACHE_TTL_SECONDS = 300


@dataclass(frozen=True)
class CachedSpec:
    spec: dict[str, Any]
    source: str
    cache_path: Path


def _cache_path(config: AppConfig) -> Path:
    cache_dir = config.path.parent / ".agent-api" / "spec-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{config.active_project}__{config.active_env}.json"
    return cache_dir / filename


def _is_fresh(path: Path, ttl_seconds: int) -> bool:
    if not path.exists():
        return False
    age_seconds = time.time() - path.stat().st_mtime
    return age_seconds <= ttl_seconds


def _load_spec(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AgentApiError("ERR_OPENAPI_UNAVAILABLE", f"Spec cache not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise AgentApiError("ERR_OPENAPI_UNAVAILABLE", f"Invalid OpenAPI JSON in cache: {path}") from exc

    if not isinstance(data, dict) or "paths" not in data:
        raise AgentApiError(
            "ERR_OPENAPI_UNAVAILABLE",
            f"OpenAPI document at '{path}' is missing a valid 'paths' object.",
        )
    return data


def fetch_and_cache_openapi(config: AppConfig) -> CachedSpec:
    url = config.env_config.openapi_url
    try:
        req = request.Request(url=url, method="GET")
    except ValueError as exc:
        raise AgentApiError(
            "ERR_OPENAPI_UNAVAILABLE",
            f"Invalid openapi_url '{url}'.",
        ) from exc
    try:
        with request.urlopen(req, timeout=30) as response:
            body = response.read()
    except error.URLError as exc:
        raise AgentApiError(
            "ERR_OPENAPI_UNAVAILABLE",
            f"Unable to fetch OpenAPI spec from '{url}': {exc.reason}",
        ) from exc

    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise AgentApiError(
            "ERR_OPENAPI_UNAVAILABLE",
            f"OpenAPI response from '{url}' is not valid JSON.",
        ) from exc

    if not isinstance(payload, dict) or "paths" not in payload:
        raise AgentApiError(
            "ERR_OPENAPI_UNAVAILABLE",
            f"OpenAPI JSON from '{url}' does not include 'paths'.",
        )

    path = _cache_path(config)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return CachedSpec(spec=payload, source="network", cache_path=path)


def load_openapi(config: AppConfig, *, force_refresh: bool = False) -> CachedSpec:
    path = _cache_path(config)
    if not force_refresh and _is_fresh(path, DEFAULT_CACHE_TTL_SECONDS):
        return CachedSpec(spec=_load_spec(path), source="cache", cache_path=path)

    try:
        return fetch_and_cache_openapi(config)
    except AgentApiError:
        if path.exists():
            return CachedSpec(spec=_load_spec(path), source="stale-cache", cache_path=path)
        raise


def iter_operations(spec: dict[str, Any]) -> list[dict[str, Any]]:
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        return []

    ops: list[dict[str, Any]] = []
    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.lower() not in OPENAPI_METHODS or not isinstance(operation, dict):
                continue
            ops.append(
                {
                    "method": method.upper(),
                    "path": str(path),
                    "operationId": operation.get("operationId", ""),
                    "summary": operation.get("summary", ""),
                    "tags": operation.get("tags", []),
                    "raw": operation,
                }
            )
    return ops


def search_operations(spec: dict[str, Any], query: str, limit: int = 20) -> list[dict[str, Any]]:
    terms = [t for t in query.lower().split() if t]
    if not terms:
        return []

    results: list[tuple[int, dict[str, Any]]] = []
    for op in iter_operations(spec):
        path = str(op["path"]).lower()
        op_id = str(op["operationId"]).lower()
        summary = str(op["summary"]).lower()
        tags_text = " ".join(str(tag).lower() for tag in op.get("tags", []))
        method = str(op["method"]).lower()

        score = 0
        for term in terms:
            if term in path:
                score += 5
            if term in op_id:
                score += 4
            if term in summary:
                score += 3
            if term in tags_text:
                score += 2
            if term == method:
                score += 2

        if score > 0:
            results.append((score, op))

    results.sort(key=lambda x: (-x[0], x[1]["path"], x[1]["method"]))
    return [{**op, "score": score} for score, op in results[:limit]]


def show_operation(spec: dict[str, Any], method: str, path_template: str) -> dict[str, Any]:
    method_key = method.lower()
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        raise AgentApiError("ERR_OPENAPI_UNAVAILABLE", "OpenAPI document has no paths.")

    item = paths.get(path_template)
    if not isinstance(item, dict):
        raise AgentApiError(
            "ERR_OPENAPI_UNAVAILABLE",
            f"Path '{path_template}' not found in OpenAPI spec.",
        )

    op = item.get(method_key)
    if not isinstance(op, dict):
        raise AgentApiError(
            "ERR_OPENAPI_UNAVAILABLE",
            f"Operation '{method.upper()} {path_template}' not found in OpenAPI spec.",
        )

    return {
        "method": method.upper(),
        "path": path_template,
        "operationId": op.get("operationId", ""),
        "summary": op.get("summary", ""),
        "description": op.get("description", ""),
        "tags": op.get("tags", []),
        "parameters": op.get("parameters", []),
        "requestBody": op.get("requestBody", {}),
        "responses": op.get("responses", {}),
    }
