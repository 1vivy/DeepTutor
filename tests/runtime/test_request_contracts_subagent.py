"""Regression: the per-turn subagent consult budget must pass chat-config validation.

``subagent_consult_budget`` rides in the request ``config`` (composer stepper)
but isn't part of any capability's public schema. It must be treated as a
runtime-only key, not rejected by ``extra="forbid"`` — otherwise a second turn
with a connected agent errors with "Extra inputs are not permitted".
"""

from __future__ import annotations

import pytest

from deeptutor.runtime.capability_routing import route_explicit_quiz_request
from deeptutor.runtime.request_contracts import (
    validate_capability_config,
    validate_chat_request_config,
)


def test_chat_config_allows_subagent_consult_budget() -> None:
    # Must not raise (it's stripped as a runtime-only key before validation).
    validate_chat_request_config({"subagent_consult_budget": 5})
    validate_capability_config("chat", {"subagent_consult_budget": 5})


def test_chat_config_still_rejects_unknown_keys() -> None:
    with pytest.raises(ValueError, match="Extra inputs are not permitted"):
        validate_chat_request_config({"totally_unknown_key": 1})


def test_explicit_quiz_routing_rules() -> None:
    route = route_explicit_quiz_request(
        "Please generate 3 quiz questions",
        "chat",
        enabled=True,
    )
    assert route is not None
    assert route.capability == "deep_question"
    assert route.requested_capability == "chat"
    assert route.auto_routed is True

    assert (
        route_explicit_quiz_request("What is formative assessment?", "chat", enabled=True) is None
    )
    assert route_explicit_quiz_request("Practice more", "chat", enabled=True) is None
    assert route_explicit_quiz_request("考考我", "deep_question", enabled=True) is None
