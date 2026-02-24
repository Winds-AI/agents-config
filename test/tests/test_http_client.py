from __future__ import annotations

import pytest

from agent_api.errors import AgentApiError
from agent_api.http_client import (
    build_url,
    encode_json_payload,
    execute_request,
    parse_header_items,
    parse_query_items,
)


def test_build_url_blocks_absolute_path() -> None:
    with pytest.raises(AgentApiError) as exc:
        build_url("https://api.dev.local", "https://evil.local/x", [])
    assert exc.value.code == "ERR_BASE_URL_OVERRIDE_BLOCKED"


def test_parse_query_items() -> None:
    parsed = parse_query_items(["a=1", "b=hello"])
    assert parsed == [("a", "1"), ("b", "hello")]

    with pytest.raises(AgentApiError):
        parse_query_items(["missing_separator"])


def test_parse_header_blocks_authorization() -> None:
    with pytest.raises(AgentApiError) as exc:
        parse_header_items(["Authorization: Bearer custom"])
    assert exc.value.code == "ERR_BASE_URL_OVERRIDE_BLOCKED"

    headers = parse_header_items(["X-Trace: abc"])
    assert headers == {"X-Trace": "abc"}


def test_encode_json_payload() -> None:
    body, obj = encode_json_payload('{"name":"x"}', None)
    assert body is not None
    assert obj == {"name": "x"}

    with pytest.raises(AgentApiError):
        encode_json_payload('{"name":"x"}', "payload.json")


def test_execute_request_reports_invalid_url() -> None:
    with pytest.raises(AgentApiError) as exc:
        execute_request(method="GET", url="not-a-url", headers={}, body=None)
    assert exc.value.code == "ERR_CONTEXT_INVALID"
