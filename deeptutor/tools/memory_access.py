"""Agent-facing tools for reading the three memory layers.

``read_memory`` (in :mod:`deeptutor.tools.builtin`) concatenates the four L3
documents and hands over the result. That is the right shape for "who is this
person" and the wrong shape for everything else: it cannot say *when*
something happened, cannot search, and cannot reach the raw workspace mirror
or the event trace at all. An agent that wants to teach against what the
learner did this week needs those.

These three tools add that, and nothing else — ``read_memory`` /
``write_memory`` keep working exactly as before:

* ``memory_index``  — what parts exist, how much is in each, how stale.
* ``memory_search`` — keyword search across L1 / T1 / L2 / L3, with an
  explicit day window and ``days_ago`` on every hit.
* ``memory_read``   — the full content behind specific refs.

They are deliberately a thin shell: all logic lives in
:mod:`deeptutor.services.memory.recall`, which the Tutor activity panel also
calls, so what the agent can see and what the learner is shown can never
drift apart.
"""

from __future__ import annotations

import json
from typing import Any

from deeptutor.core.tool_protocol import (
    BaseTool,
    ToolDefinition,
    ToolParameter,
    ToolResult,
)

# Every import below the tool protocol is deferred into the function that needs
# it. ``tools.builtin`` imports this module to register these tools, and it is
# itself imported by the tool registry, so a module-level import of anything
# under ``deeptutor.services`` would close the cycle at interpreter start.
# ``partner_memory`` is structured the same way for the same reason.


# The vocabulary the schemas advertise, mirrored from
# ``deeptutor.services.memory.paths`` / ``.refs`` instead of imported.
# ``get_definition`` is called *during* the import of ``tools.builtin`` (it
# builds its name table by reading every tool's ``.name``), and reaching into
# ``deeptutor.services`` at that instant closes a cycle back into the
# half-built module. ``tests/tools/test_memory_access.py`` asserts these tuples
# stay identical to the real ones, so a new surface cannot silently desync.
_SURFACES: tuple[str, ...] = (
    "chat",
    "notebook",
    "quiz",
    "kb",
    "book",
    "partner",
    "cowriter",
)
_L3_SLOTS: tuple[str, ...] = ("recent", "profile", "scope", "preferences")
_LAYERS: tuple[str, ...] = ("L1", "T1", "L2", "L3")


class _HintedTool:
    """Loads this tool's YAML prompt hints.

    A local twin of ``builtin._PromptHintsMixin`` rather than an import of it,
    for the cycle reason above.
    """

    def get_prompt_hints(self, language: str = "en"):
        from deeptutor.tools.prompting import load_prompt_hints

        return load_prompt_hints(self.name, language=language)  # type: ignore[attr-defined]


def _json(payload: dict[str, Any], *, meta_key: str) -> ToolResult:
    """Serialize a payload for the model, keeping the object for the UI."""
    return ToolResult(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        metadata={meta_key: payload},
    )


def _as_list(raw: Any) -> list[str]:
    """Accept a list, a JSON array, or a comma/space-separated string.

    Providers differ in how reliably they emit real JSON arrays for array
    parameters; a tool that rejects ``"L1, L2"`` would fail for reasons the
    model cannot see or fix.
    """
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(item).strip() for item in raw if str(item).strip()]
    text = str(raw).strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    return [part.strip() for part in text.replace(",", " ").split() if part.strip()]


def _as_optional_int(raw: Any) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


class MemoryIndexTool(_HintedTool, BaseTool):
    """What memory holds, one level deep."""

    def get_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="memory_index",
            description=(
                "List what the user's memory contains before you search it: "
                "which surfaces have recorded activity (L1) and raw events "
                "(T1), how many items each holds and how recent they are, "
                "plus which consolidated documents exist (L2 per surface, L3 "
                "cross-surface) and how far behind they are. Call this first "
                "when you don't know where the relevant material lives; it "
                "reads no content and costs nothing."
            ),
            parameters=[],
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        _ = kwargs
        from deeptutor.services.memory import recall

        return _json(recall.index(), meta_key="memory_index")


class MemorySearchTool(_HintedTool, BaseTool):
    """Keyword search across the memory layers."""

    def get_definition(self) -> ToolDefinition:
        surface_list = ", ".join(_SURFACES)
        slot_list = ", ".join(_L3_SLOTS)
        layer_list = ", ".join(_LAYERS)
        return ToolDefinition(
            name="memory_search",
            description=(
                "Search the user's memory by keyword and get back refs you can "
                "read. Every hit reports how many days ago it happened, so you "
                "can judge whether it is still relevant. Searches raw activity "
                "(L1 — conversations, quiz attempts, documents), raw events "
                "(T1), and the consolidated summaries (L2 per surface, L3 "
                "cross-surface). Use `days` to bound the lookback (e.g. 3 for "
                "'this week's work'), `surfaces` to target one kind of "
                "activity, then memory_read the refs that look relevant."
            ),
            parameters=[
                ToolParameter(
                    name="query",
                    type="string",
                    description=(
                        "Keywords; all must appear. Leave empty to list recent "
                        "activity instead of matching on text."
                    ),
                    required=False,
                ),
                ToolParameter(
                    name="days",
                    type="integer",
                    description=(
                        "Only consider items from the last N days. Omit for no time limit."
                    ),
                    required=False,
                ),
                ToolParameter(
                    name="layers",
                    type="array",
                    description=f"Restrict to these layers ({layer_list}). Default: all.",
                    required=False,
                    items={"type": "string", "enum": list(_LAYERS)},
                ),
                ToolParameter(
                    name="surfaces",
                    type="array",
                    description=(
                        f"Restrict to these surfaces ({surface_list}). "
                        "Default: all. Ignored for L3, which is cross-surface "
                        f"({slot_list})."
                    ),
                    required=False,
                    items={"type": "string", "enum": list(_SURFACES)},
                ),
                ToolParameter(
                    name="limit",
                    type="integer",
                    description="Maximum hits to return (default 20, max 100).",
                    required=False,
                ),
            ],
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        from deeptutor.services.memory import recall

        query = str(kwargs.get("query") or "").strip()
        days = _as_optional_int(kwargs.get("days"))
        limit = _as_optional_int(kwargs.get("limit"))
        layers = _as_list(kwargs.get("layers"))
        surfaces = _as_list(kwargs.get("surfaces"))

        if not query:
            # An empty query is "what happened lately", which the stamps path
            # answers without reading any content.
            hits = recall.recent(
                days=days if days is not None else 3,
                limit=limit,
                surfaces=surfaces or None,
            )
        else:
            hits = recall.search(
                query,
                layers=layers or None,
                surfaces=surfaces or None,
                days=days,
                limit=limit,
            )
        payload = {
            "query": query,
            "days": days,
            "count": len(hits),
            "hits": [hit.to_dict() for hit in hits],
        }
        if not hits:
            payload["note"] = (
                "Nothing matched. Try memory_index to see which surfaces hold "
                "material, widen `days`, or use fewer keywords."
            )
        return _json(payload, meta_key="memory_search")


class MemoryReadTool(_HintedTool, BaseTool):
    """Full content behind memory refs."""

    def get_definition(self) -> ToolDefinition:
        slot_list = ", ".join(_L3_SLOTS)
        return ToolDefinition(
            name="memory_read",
            description=(
                "Read the full content behind memory refs returned by "
                "memory_search or memory_index. Refs look like "
                "`L1:chat:<session_id>` (a whole conversation), "
                "`T1:kb:<trace_id>` (one raw event), `L2:<surface>` (a "
                "surface's consolidated summary) or `L3:profile` "
                f"(cross-surface: {slot_list}). Pass several at once."
            ),
            parameters=[
                ToolParameter(
                    name="refs",
                    type="array",
                    description=('Refs to read, e.g. ["L1:chat:unified_123", "L2:quiz"].'),
                    required=True,
                    items={"type": "string"},
                ),
            ],
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        from deeptutor.services.memory import recall

        refs = _as_list(kwargs.get("refs"))
        if not refs:
            return ToolResult(
                content=(
                    "memory_read needs at least one ref. Get refs from "
                    "memory_search or memory_index."
                ),
                success=False,
            )
        items = recall.read(refs)
        payload = {
            "count": sum(1 for item in items if item.found),
            "items": [item.to_dict() for item in items],
        }
        return _json(payload, meta_key="memory_read")


MEMORY_ACCESS_TOOL_TYPES: tuple[type[BaseTool], ...] = (
    MemoryIndexTool,
    MemorySearchTool,
    MemoryReadTool,
)

# Spelled out rather than derived from the definitions: reading ``.name`` calls
# ``get_definition()``, which reaches into ``deeptutor.services`` — and at the
# moment ``tools.builtin`` imports this module, that path leads back to a
# half-initialised ``tools.builtin``. ``tests/tools/test_memory_access.py``
# asserts this tuple still matches what the tools actually declare.
MEMORY_ACCESS_TOOL_NAMES: tuple[str, ...] = (
    "memory_index",
    "memory_search",
    "memory_read",
)

__all__ = [
    "MEMORY_ACCESS_TOOL_NAMES",
    "MEMORY_ACCESS_TOOL_TYPES",
    "MemoryIndexTool",
    "MemoryReadTool",
    "MemorySearchTool",
]
