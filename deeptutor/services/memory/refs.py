"""Addressing for the three memory layers.

Memory holds four kinds of readable thing, and an agent that can search across
them needs one way to point at any of them:

===============================  =========================================
``L1:<surface>:<entity_id>``     one workspace entity — a conversation, a
                                 quiz attempt, a document, a book
``T1:<surface>:<trace_id>``      one raw event from the append-only trace
``L2:<surface>``                 a surface's consolidated summary document
``L3:<slot>``                    one of the four cross-surface documents
===============================  =========================================

L1 and T1 are both "layer 1" — the workspace mirror and the event stream —
but they are addressed separately because they are stored separately and
answer different questions ("what exists" vs "what happened").

Parsing is total and never raises: an unparseable ref yields ``None`` so a
model handing back a mangled string produces a per-ref error rather than
failing the whole tool call. ``key`` is validated against the surface / slot
whitelists, which is also what keeps a ref from ever reaching the filesystem
as an arbitrary path — the only path components a ref can produce are names
that already exist in :data:`SURFACES` / :data:`L3_SLOTS`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from deeptutor.services.memory.paths import L3_SLOTS, SURFACES

Layer = Literal["L1", "T1", "L2", "L3"]

LAYERS: tuple[Layer, ...] = ("L1", "T1", "L2", "L3")

# Layers whose ref names an item inside a container, vs layers that name a
# whole document.
_ITEM_LAYERS: frozenset[str] = frozenset({"L1", "T1"})


@dataclass(frozen=True, slots=True)
class MemoryRef:
    """A parsed, validated pointer into memory."""

    layer: Layer
    key: str  # surface name, or L3 slot name
    item: str = ""  # entity id / trace id; empty for whole-document layers

    def __str__(self) -> str:
        return f"{self.layer}:{self.key}:{self.item}" if self.item else f"{self.layer}:{self.key}"

    @property
    def is_document(self) -> bool:
        return self.layer not in _ITEM_LAYERS


def format_ref(layer: Layer, key: str, item: str = "") -> str:
    """Build a ref string. Mirrors :meth:`MemoryRef.__str__`."""
    return f"{layer}:{key}:{item}" if item else f"{layer}:{key}"


def parse_ref(raw: str) -> MemoryRef | None:
    """Parse ``raw`` into a :class:`MemoryRef`, or ``None`` if it is not one.

    Item ids may themselves contain ``:`` — trace ids look like
    ``chat:01KRX…`` and quiz entity ids like ``<session>:<question>`` — so the
    split is bounded to two, and everything after the second colon is the item.
    """
    text = (raw or "").strip()
    if not text:
        return None
    parts = text.split(":", 2)
    layer = parts[0].strip()
    if layer not in LAYERS:
        return None
    if len(parts) < 2:
        return None
    key = parts[1].strip()
    item = parts[2].strip() if len(parts) > 2 else ""

    if layer == "L3":
        if key not in L3_SLOTS or item:
            return None
        return MemoryRef(layer="L3", key=key)
    if key not in SURFACES:
        return None
    if layer == "L2":
        # ``L2:chat:something`` is not a finer address, it is a mistake.
        return MemoryRef(layer="L2", key=key) if not item else None
    if not item:
        return None
    return MemoryRef(layer=layer, key=key, item=item)  # type: ignore[arg-type]


__all__ = ["LAYERS", "Layer", "MemoryRef", "format_ref", "parse_ref"]
