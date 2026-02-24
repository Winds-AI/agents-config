from __future__ import annotations

from typing import Any

from .errors import AgentApiError

READ_METHODS = {"GET", "HEAD", "OPTIONS"}
WRITE_METHODS = {"POST", "PUT", "PATCH"}
ALL_SUPPORTED_METHODS = READ_METHODS | WRITE_METHODS | {"DELETE"}
MARKER = "[agent-test]"


def _iter_string_values(value: Any):
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, dict):
        for nested in value.values():
            yield from _iter_string_values(nested)
        return
    if isinstance(value, list):
        for nested in value:
            yield from _iter_string_values(nested)


def validate_policy(
    *,
    api_mode: str,
    method: str,
    json_body: Any | None,
    confirm_delete: bool,
) -> None:
    normalized_method = method.upper()
    if normalized_method not in ALL_SUPPORTED_METHODS:
        raise AgentApiError(
            "ERR_METHOD_BLOCKED_BY_MODE",
            f"HTTP method '{normalized_method}' is not supported by this tool.",
        )

    if api_mode == "read-only":
        if normalized_method not in READ_METHODS:
            raise AgentApiError(
                "ERR_METHOD_BLOCKED_BY_MODE",
                f"'{normalized_method}' is blocked in read-only mode.",
            )
        return

    if api_mode == "safe-updates":
        if normalized_method == "DELETE":
            raise AgentApiError(
                "ERR_METHOD_BLOCKED_BY_MODE",
                "DELETE is blocked in safe-updates mode.",
            )
        if normalized_method in WRITE_METHODS:
            if json_body is None:
                raise AgentApiError(
                    "ERR_MARKER_MISSING",
                    "safe-updates writes require a JSON body with [agent-test] markers.",
                )

            strings = list(_iter_string_values(json_body))
            if not strings:
                raise AgentApiError(
                    "ERR_UNMARKABLE_PAYLOAD",
                    "safe-updates writes require at least one string field containing [agent-test].",
                )

            # The strict rule is intentional in v1 to prevent accidental unmarked writes.
            missing_marker = [s for s in strings if MARKER not in s]
            if missing_marker:
                raise AgentApiError(
                    "ERR_MARKER_MISSING",
                    "All string values in safe-updates write payloads must include [agent-test].",
                )
        return

    if api_mode == "full-access":
        if normalized_method == "DELETE" and not confirm_delete:
            raise AgentApiError(
                "ERR_DELETE_CONFIRMATION_REQUIRED",
                "DELETE requires --confirm-delete in full-access mode.",
            )
        return

    raise AgentApiError(
        "ERR_CONTEXT_INVALID",
        f"Unknown api_mode '{api_mode}'.",
    )
