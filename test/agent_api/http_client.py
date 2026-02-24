from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
import json
import re
from urllib import error, parse, request

from .errors import AgentApiError

_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")


@dataclass(frozen=True)
class HttpResult:
    status: int
    headers: dict[str, str]
    body: bytes


def build_url(api_base: str, path: str, query_pairs: Iterable[tuple[str, str]]) -> str:
    if _SCHEME_RE.match(path):
        raise AgentApiError(
            "ERR_BASE_URL_OVERRIDE_BLOCKED",
            "Absolute URL is not allowed. Use a relative path, for example '/products'.",
        )
    if not path.startswith("/"):
        raise AgentApiError(
            "ERR_BASE_URL_OVERRIDE_BLOCKED",
            "Path must start with '/'.",
        )

    normalized_base = api_base.rstrip("/")
    url = f"{normalized_base}{path}"
    query = parse.urlencode(list(query_pairs), doseq=True)
    if query:
        url = f"{url}?{query}"
    return url


def parse_query_items(query_items: list[str] | None) -> list[tuple[str, str]]:
    parsed: list[tuple[str, str]] = []
    for raw in query_items or []:
        if "=" not in raw:
            raise AgentApiError(
                "ERR_CONTEXT_INVALID",
                f"Invalid query item '{raw}'. Expected key=value format.",
            )
        key, value = raw.split("=", 1)
        parsed.append((key, value))
    return parsed


def parse_header_items(header_items: list[str] | None) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for raw in header_items or []:
        if ":" not in raw:
            raise AgentApiError(
                "ERR_CONTEXT_INVALID",
                f"Invalid header '{raw}'. Expected 'Name: value' format.",
            )
        key, value = raw.split(":", 1)
        normalized_key = key.strip()
        if not normalized_key:
            raise AgentApiError("ERR_CONTEXT_INVALID", f"Invalid header key in '{raw}'.")
        if normalized_key.lower() == "authorization":
            raise AgentApiError(
                "ERR_BASE_URL_OVERRIDE_BLOCKED",
                "Custom Authorization header is blocked. Use configured tokens instead.",
            )
        parsed[normalized_key] = value.strip()
    return parsed


def encode_json_payload(
    json_inline: str | None,
    json_file: str | None,
) -> tuple[bytes | None, object | None]:
    if json_inline and json_file:
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            "Use only one of --json or --json-file.",
        )

    if json_inline is None and json_file is None:
        return None, None

    if json_file is not None:
        try:
            payload = json.loads(open(json_file, "r", encoding="utf-8").read())
        except FileNotFoundError:
            raise AgentApiError(
                "ERR_CONTEXT_INVALID",
                f"JSON file not found: {json_file}",
            ) from None
        except json.JSONDecodeError as exc:
            raise AgentApiError(
                "ERR_CONTEXT_INVALID",
                f"Invalid JSON in file '{json_file}': {exc}",
            ) from exc
    else:
        try:
            payload = json.loads(json_inline or "")
        except json.JSONDecodeError as exc:
            raise AgentApiError(
                "ERR_CONTEXT_INVALID",
                f"Invalid JSON for --json: {exc}",
            ) from exc

    return json.dumps(payload).encode("utf-8"), payload


def execute_request(
    *,
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
    timeout_seconds: int = 30,
) -> HttpResult:
    try:
        req = request.Request(url=url, data=body, method=method.upper(), headers=headers)
    except ValueError as exc:
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            f"Invalid request URL '{url}'. Check api_base and path.",
        ) from exc
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            return HttpResult(
                status=response.status,
                headers=dict(response.headers.items()),
                body=response.read(),
            )
    except error.HTTPError as exc:
        return HttpResult(
            status=exc.code,
            headers=dict(exc.headers.items()),
            body=exc.read(),
        )
    except error.URLError as exc:
        raise AgentApiError(
            "ERR_CONTEXT_INVALID",
            f"Network error while calling '{url}': {exc.reason}",
        ) from exc
