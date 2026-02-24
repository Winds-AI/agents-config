from __future__ import annotations

import pytest

from agent_api.errors import AgentApiError
from agent_api.policy import validate_policy


def test_read_only_blocks_writes() -> None:
    validate_policy(api_mode="read-only", method="GET", json_body=None, confirm_delete=False)

    with pytest.raises(AgentApiError) as exc:
        validate_policy(api_mode="read-only", method="POST", json_body={"a": 1}, confirm_delete=False)

    assert exc.value.code == "ERR_METHOD_BLOCKED_BY_MODE"


def test_safe_updates_requires_marker_on_all_string_fields() -> None:
    valid = {
        "name": "Widget [agent-test]",
        "metadata": {"description": "desc [agent-test]"},
    }
    validate_policy(api_mode="safe-updates", method="POST", json_body=valid, confirm_delete=False)

    invalid = {
        "name": "Widget [agent-test]",
        "metadata": {"description": "desc without marker"},
    }
    with pytest.raises(AgentApiError) as exc:
        validate_policy(api_mode="safe-updates", method="POST", json_body=invalid, confirm_delete=False)

    assert exc.value.code == "ERR_MARKER_MISSING"


def test_safe_updates_rejects_delete_and_unmarkable_payload() -> None:
    with pytest.raises(AgentApiError) as exc_delete:
        validate_policy(api_mode="safe-updates", method="DELETE", json_body=None, confirm_delete=False)
    assert exc_delete.value.code == "ERR_METHOD_BLOCKED_BY_MODE"

    with pytest.raises(AgentApiError) as exc_unmarkable:
        validate_policy(api_mode="safe-updates", method="PATCH", json_body={"count": 1}, confirm_delete=False)
    assert exc_unmarkable.value.code == "ERR_UNMARKABLE_PAYLOAD"


def test_full_access_delete_requires_confirmation() -> None:
    with pytest.raises(AgentApiError) as exc:
        validate_policy(api_mode="full-access", method="DELETE", json_body=None, confirm_delete=False)
    assert exc.value.code == "ERR_DELETE_CONFIRMATION_REQUIRED"

    validate_policy(api_mode="full-access", method="DELETE", json_body=None, confirm_delete=True)
