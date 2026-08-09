"""The memory tools as the model sees them.

Two of these guard deliberate duplication. ``memory_access`` spells out the
surface / slot / layer vocabulary and its own tool names instead of importing
them, because reading a tool's ``.name`` happens *during* the import of
``tools.builtin`` and reaching into ``deeptutor.services`` at that moment closes
an import cycle. The duplication is safe only while something checks it, which
is what ``test_declared_*`` do.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from deeptutor.tools import memory_access
from deeptutor.tools.memory_access import (
    MEMORY_ACCESS_TOOL_NAMES,
    MEMORY_ACCESS_TOOL_TYPES,
    MemoryIndexTool,
    MemoryReadTool,
    MemorySearchTool,
)


def _payload(result: Any) -> dict[str, Any]:
    return json.loads(result.content)


# ── The duplication guards ───────────────────────────────────────────────


def test_declared_vocabulary_matches_the_real_one() -> None:
    from deeptutor.services.memory.paths import L3_SLOTS, SURFACES
    from deeptutor.services.memory.refs import LAYERS

    assert memory_access._SURFACES == SURFACES
    assert memory_access._L3_SLOTS == L3_SLOTS
    assert memory_access._LAYERS == LAYERS


def test_declared_tool_names_match_the_definitions() -> None:
    actual = tuple(tool_type().get_definition().name for tool_type in MEMORY_ACCESS_TOOL_TYPES)
    assert MEMORY_ACCESS_TOOL_NAMES == actual


def test_tools_are_registered_and_owner_configurable() -> None:
    from deeptutor.tools.builtin import (
        BUILTIN_TOOL_NAMES,
        CONFIGURABLE_BUILTIN_TOOL_NAMES,
    )

    for name in MEMORY_ACCESS_TOOL_NAMES:
        assert name in BUILTIN_TOOL_NAMES
        assert name in CONFIGURABLE_BUILTIN_TOOL_NAMES


def test_tools_mount_on_the_memory_gate() -> None:
    """They ride ``has_memory`` — the same gate ``read_memory`` uses."""
    from deeptutor.agents._shared.tool_composition import _CONDITIONAL_MOUNT_FLAGS

    for name in MEMORY_ACCESS_TOOL_NAMES:
        assert _CONDITIONAL_MOUNT_FLAGS[name] == "has_memory"


def test_partner_turns_suppress_them() -> None:
    """Partners reach memory through their own workspace-scoped tools."""
    from deeptutor.agents.chat.agentic_pipeline import _PARTNER_SUPPRESSED_TOOLS

    for name in MEMORY_ACCESS_TOOL_NAMES:
        assert name in _PARTNER_SUPPRESSED_TOOLS


# ── Schemas ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("tool_type", MEMORY_ACCESS_TOOL_TYPES)
def test_array_parameters_declare_items(tool_type: type) -> None:
    """Gemini / Anthropic reject an array parameter with no ``items``."""
    definition = tool_type().get_definition()
    for parameter in definition.parameters:
        parameter.to_schema()
        if parameter.type == "array":
            assert parameter.items, f"{definition.name}.{parameter.name}"


@pytest.mark.parametrize("tool_type", MEMORY_ACCESS_TOOL_TYPES)
@pytest.mark.parametrize("language", ["en", "zh"])
def test_prompt_hints_exist_in_both_languages(tool_type: type, language: str) -> None:
    hints = tool_type().get_prompt_hints(language)
    assert hints.short_description
    assert hints.when_to_use


# ── Argument coercion ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, []),
        ("", []),
        ([], []),
        (["L1", "L2"], ["L1", "L2"]),
        ('["L1", "L2"]', ["L1", "L2"]),  # JSON array as a string
        ("L1, L2", ["L1", "L2"]),  # comma separated
        ("L1 L2", ["L1", "L2"]),  # space separated
        ("L1", ["L1"]),
        ("[bad json", ["[bad", "json"]),  # falls back to splitting
    ],
)
def test_list_arguments_accept_what_providers_actually_send(raw: Any, expected: list[str]) -> None:
    assert memory_access._as_list(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [(None, None), ("", None), ("7", 7), (7, 7), ("nonsense", None), (3.9, 3)],
)
def test_optional_int_arguments_never_raise(raw: Any, expected: int | None) -> None:
    assert memory_access._as_optional_int(raw) == expected


# ── Behaviour ────────────────────────────────────────────────────────────


def test_search_delegates_to_recall_and_reports_days(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deeptutor.services.memory import recall

    captured: dict[str, Any] = {}

    def _search(query: str, **kwargs: Any) -> list[recall.RecallHit]:
        captured.update({"query": query, **kwargs})
        return [
            recall.RecallHit(
                ref="L1:chat:abc",
                layer="L1",
                key="chat",
                label="A chat",
                ts="2026-08-06T00:00:00+00:00",
                days_ago=3,
                snippet="…matched…",
            )
        ]

    monkeypatch.setattr(recall, "search", _search)
    result = asyncio.run(MemorySearchTool().execute(query="rag", days=7, layers="L1", limit=5))
    payload = _payload(result)

    assert captured["query"] == "rag"
    assert captured["days"] == 7
    assert captured["layers"] == ["L1"]
    assert payload["count"] == 1
    hit = payload["hits"][0]
    assert hit["ref"] == "L1:chat:abc"
    assert hit["days_ago"] == 3


def test_empty_query_lists_recent_activity_instead(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty query is "what happened lately" — the cheap stamps path."""
    from deeptutor.services.memory import recall

    called: dict[str, Any] = {}

    def _recent(**kwargs: Any) -> list[recall.RecallHit]:
        called.update(kwargs)
        return []

    monkeypatch.setattr(recall, "recent", _recent)
    monkeypatch.setattr(recall, "search", lambda *a, **k: pytest.fail("search must not run"))

    result = asyncio.run(MemorySearchTool().execute(query="   "))
    assert called["days"] == 3  # a sensible default window, not "everything"
    assert "note" in _payload(result)  # empty results explain themselves


def test_read_requires_at_least_one_ref() -> None:
    result = asyncio.run(MemoryReadTool().execute(refs=[]))
    assert not result.success
    assert "at least one ref" in result.content


def test_read_reports_per_ref_outcomes(monkeypatch: pytest.MonkeyPatch) -> None:
    from deeptutor.services.memory import recall

    monkeypatch.setattr(
        recall,
        "read",
        lambda refs: [
            recall.RecallItem(ref="L2:chat", found=True, label="L2 · chat", content="body"),
            recall.RecallItem(ref="bogus", found=False, error="Unparseable ref."),
        ],
    )
    payload = _payload(asyncio.run(MemoryReadTool().execute(refs=["L2:chat", "bogus"])))

    assert payload["count"] == 1  # found ones only
    assert payload["items"][1] == {
        "ref": "bogus",
        "found": False,
        "error": "Unparseable ref.",
    }


def test_index_returns_the_four_layer_buckets(monkeypatch: pytest.MonkeyPatch) -> None:
    from deeptutor.services.memory import recall

    monkeypatch.setattr(
        recall, "index", lambda: {"L1": [{"surface": "chat"}], "T1": [], "L2": [], "L3": []}
    )
    payload = _payload(asyncio.run(MemoryIndexTool().execute()))
    assert set(payload) == {"L1", "T1", "L2", "L3"}


def test_results_carry_the_payload_in_metadata_for_the_ui(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deeptutor.services.memory import recall

    monkeypatch.setattr(recall, "index", lambda: {"L1": [], "T1": [], "L2": [], "L3": []})
    result = asyncio.run(MemoryIndexTool().execute())
    assert "memory_index" in result.metadata
