"""Reading memory back — the query side of the three layers.

Everything that asks memory "what do you have, what matches, show me that one"
goes through here: the agent's memory tools, and the Tutor activity panel.
Deliberately one implementation for both, because a panel that showed the
learner different activity from what the tutor can see would be worse than a
panel that showed nothing.

Four questions, four entry points:

* :func:`index`  — what parts exist at all (surfaces, documents, how much is
  in each, how far behind consolidation is).
* :func:`recent` — what happened lately, newest first. Runs on stamps, so it
  never reads content: this is the one an interactive panel calls on load.
* :func:`search` — which items match some keywords. Reads content, because
  that is what "match" means here.
* :func:`read`   — the full text behind specific refs.

Every hit carries ``days_ago`` computed here rather than an ISO timestamp for
the caller to subtract. A model asked to do date arithmetic on
``2026-08-06T11:03:00+00:00`` will sometimes get it wrong, and "how long ago"
is the entire basis on which a tutor decides whether something is still
relevant today.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
from typing import Any, Iterable, Sequence

from deeptutor.services.memory.paths import L3_SLOTS, SURFACES, Surface
from deeptutor.services.memory.refs import LAYERS, Layer, MemoryRef, format_ref, parse_ref

logger = logging.getLogger(__name__)

# A snippet wide enough to judge relevance, narrow enough that twenty of them
# don't crowd out the conversation.
_SNIPPET_CHARS = 240
_MAX_LIMIT = 100
_DEFAULT_LIMIT = 20


@dataclass(frozen=True, slots=True)
class RecallHit:
    """One match or one recent item, shaped for a model to act on."""

    ref: str
    layer: str
    key: str
    label: str
    ts: str
    days_ago: int | None
    snippet: str = ""

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "ref": self.ref,
            "layer": self.layer,
            "key": self.key,
            "label": self.label,
            "days_ago": self.days_ago,
        }
        if self.ts:
            out["ts"] = self.ts
        if self.snippet:
            out["snippet"] = self.snippet
        return out


@dataclass(frozen=True, slots=True)
class RecallItem:
    """Full content behind one ref, or the reason there isn't any."""

    ref: str
    found: bool
    label: str = ""
    ts: str = ""
    days_ago: int | None = None
    content: str = ""
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        if not self.found:
            return {"ref": self.ref, "found": False, "error": self.error}
        out: dict[str, Any] = {
            "ref": self.ref,
            "found": True,
            "label": self.label,
            "days_ago": self.days_ago,
            "content": self.content,
        }
        if self.ts:
            out["ts"] = self.ts
        if self.metadata:
            out["metadata"] = self.metadata
        return out


# ── Time ─────────────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _parse_ts(ts: str) -> datetime | None:
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def days_ago(ts: str, *, now: datetime | None = None) -> int | None:
    """Whole days between ``ts`` and now, or ``None`` for an unusable stamp.

    Clamped at zero: a timestamp slightly in the future (clock skew between
    a writer and this process) is "today", never a negative age.
    """
    parsed = _parse_ts(ts)
    if parsed is None:
        return None
    delta = (now or _now()) - parsed
    return max(0, delta.days)


def _within_days(
    ts: str,
    window: int | None,
    now: datetime,
    *,
    keep_undated: bool = True,
) -> bool:
    """Whether ``ts`` falls inside a ``window``-day lookback.

    ``keep_undated`` decides what an unusable timestamp means, and the answer
    differs by caller. A keyword search keeps it: some adapters cannot produce
    a date at all (a knowledge base carries only its earliest index time), and
    dropping those would quietly narrow the search to the well-dated surfaces.
    A "what happened lately" listing drops it: an item of unknown age placed
    in "the last three days" asserts something the data does not support.
    """
    if window is None:
        return True
    age = days_ago(ts, now=now)
    if age is None:
        return keep_undated
    return age <= window


# ── Text matching ────────────────────────────────────────────────────────


def _terms(query: str) -> list[str]:
    """Whitespace-split, lowercased search terms; all must be present.

    No tokenisation beyond whitespace, so a CJK query works as a substring
    match — which is the behaviour a learner searching "链式法则" expects.
    """
    return [term for term in (query or "").lower().split() if term]


def _matches(haystack: str, terms: Sequence[str]) -> bool:
    if not terms:
        return True
    lowered = haystack.lower()
    return all(term in lowered for term in terms)


def _snippet(text: str, terms: Sequence[str], *, width: int = _SNIPPET_CHARS) -> str:
    """A window around the first matching term, or the head of the text."""
    flat = " ".join((text or "").split())
    if not flat:
        return ""
    start = 0
    if terms:
        lowered = flat.lower()
        positions = [lowered.find(term) for term in terms]
        found = [pos for pos in positions if pos >= 0]
        if found:
            start = max(0, min(found) - width // 4)
    window = flat[start : start + width]
    prefix = "…" if start > 0 else ""
    suffix = "…" if start + width < len(flat) else ""
    return f"{prefix}{window}{suffix}"


# ── Normalising caller input ─────────────────────────────────────────────


def _resolve_layers(layers: Iterable[str] | None) -> tuple[Layer, ...]:
    if not layers:
        return LAYERS
    wanted = {str(layer).strip().upper() for layer in layers}
    resolved = tuple(layer for layer in LAYERS if layer in wanted)
    return resolved or LAYERS


def _resolve_surfaces(surfaces: Iterable[str] | None) -> tuple[Surface, ...]:
    if not surfaces:
        return SURFACES
    wanted = {str(surface).strip().lower() for surface in surfaces}
    resolved = tuple(surface for surface in SURFACES if surface in wanted)
    return resolved or SURFACES


def _clamp_limit(limit: int | None) -> int:
    if not limit or limit < 1:
        return _DEFAULT_LIMIT
    return min(int(limit), _MAX_LIMIT)


# ── index ────────────────────────────────────────────────────────────────


def index() -> dict[str, Any]:
    """Everything memory holds, one level deep.

    The point is orientation before retrieval: an agent that knows chat has
    864 entities and ``L2:book`` does not exist yet can pick where to look
    instead of guessing surface names.
    """
    from deeptutor.services.memory import get_memory_store, trace
    from deeptutor.services.memory.autopilot import unconsolidated_count
    from deeptutor.services.memory.snapshot import adapters

    now = _now()
    l1: list[dict[str, Any]] = []
    t1: list[dict[str, Any]] = []
    for surface in SURFACES:
        try:
            stamps = adapters.read_stamps(surface)
        except Exception:
            logger.warning("index: stamps failed surface=%s", surface, exc_info=True)
            stamps = []
        if stamps:
            newest = max((s.ts for s in stamps if s.ts), default="")
            l1.append(
                {
                    "surface": surface,
                    "entities": len(stamps),
                    "latest_ts": newest,
                    "latest_days_ago": days_ago(newest, now=now) if newest else None,
                    "unconsolidated": unconsolidated_count(surface),
                }
            )
        try:
            events = trace.count_since(surface)
        except Exception:
            events = 0
        if events:
            latest = trace.latest_ts(surface) or ""
            t1.append(
                {
                    "surface": surface,
                    "events": events,
                    "latest_ts": latest,
                    "latest_days_ago": days_ago(latest, now=now) if latest else None,
                }
            )

    docs = get_memory_store().overview()
    l2 = [
        {
            "surface": row.key,
            "ref": format_ref("L2", row.key),
            "exists": row.exists,
            "entries": row.entry_count,
            "updated_at": row.updated_at,
            "backlog": row.backlog,
        }
        for row in docs
        if row.layer == "L2"
    ]
    l3 = [
        {
            "slot": row.key,
            "ref": format_ref("L3", row.key),
            "exists": row.exists,
            "entries": row.entry_count,
            "updated_at": row.updated_at,
        }
        for row in docs
        if row.layer == "L3"
    ]
    return {"L1": l1, "T1": t1, "L2": l2, "L3": l3}


# ── recent ───────────────────────────────────────────────────────────────


def recent(
    *,
    days: int | None = 3,
    limit: int | None = _DEFAULT_LIMIT,
    surfaces: Iterable[str] | None = None,
) -> list[RecallHit]:
    """The latest workspace activity across surfaces, newest first.

    Stamps only — no content is read, so this stays cheap enough for a panel
    that loads on every visit. Callers who want the substance of a hit follow
    up with :func:`read` on its ref.
    """
    from deeptutor.services.memory.snapshot import adapters

    now = _now()
    bound = _clamp_limit(limit)
    hits: list[RecallHit] = []
    for surface in _resolve_surfaces(surfaces):
        try:
            stamps = adapters.read_stamps(surface)
        except Exception:
            logger.warning("recent: stamps failed surface=%s", surface, exc_info=True)
            continue
        for stamp in stamps:
            if not _within_days(stamp.ts, days, now, keep_undated=False):
                continue
            hits.append(
                RecallHit(
                    ref=format_ref("L1", surface, stamp.id),
                    layer="L1",
                    key=surface,
                    label=stamp.label,
                    ts=stamp.ts,
                    days_ago=days_ago(stamp.ts, now=now),
                )
            )
    # Undated items sort last rather than first: "" would otherwise win a
    # descending sort and push genuinely recent activity off the list.
    hits.sort(key=lambda hit: (hit.ts != "", hit.ts), reverse=True)
    return hits[:bound]


# ── search ───────────────────────────────────────────────────────────────


def search(
    query: str,
    *,
    layers: Iterable[str] | None = None,
    surfaces: Iterable[str] | None = None,
    days: int | None = None,
    limit: int | None = _DEFAULT_LIMIT,
) -> list[RecallHit]:
    """Keyword search across the requested layers, newest match first."""
    now = _now()
    terms = _terms(query)
    wanted_layers = _resolve_layers(layers)
    wanted_surfaces = _resolve_surfaces(surfaces)
    bound = _clamp_limit(limit)

    hits: list[RecallHit] = []
    if "L1" in wanted_layers:
        hits.extend(_search_l1(terms, wanted_surfaces, days, now))
    if "T1" in wanted_layers:
        hits.extend(_search_t1(terms, wanted_surfaces, days, now))
    if "L2" in wanted_layers:
        hits.extend(_search_docs("L2", wanted_surfaces, terms, now))
    if "L3" in wanted_layers:
        hits.extend(_search_docs("L3", L3_SLOTS, terms, now))

    hits.sort(key=lambda hit: (hit.ts != "", hit.ts), reverse=True)
    return hits[:bound]


def _search_l1(
    terms: Sequence[str],
    surfaces: Sequence[Surface],
    days: int | None,
    now: datetime,
) -> list[RecallHit]:
    from deeptutor.services.memory.snapshot import adapters

    out: list[RecallHit] = []
    for surface in surfaces:
        try:
            entities = adapters.read_entities(surface)
        except Exception:
            logger.warning("search: entities failed surface=%s", surface, exc_info=True)
            continue
        for entity in entities:
            if not _within_days(entity.ts, days, now):
                continue
            if not _matches(f"{entity.label}\n{entity.content}", terms):
                continue
            out.append(
                RecallHit(
                    ref=format_ref("L1", surface, entity.id),
                    layer="L1",
                    key=surface,
                    label=entity.label,
                    ts=entity.ts,
                    days_ago=days_ago(entity.ts, now=now),
                    snippet=_snippet(entity.content, terms),
                )
            )
    return out


def _trace_text(payload: Any) -> str:
    """Flatten a trace payload to searchable text."""
    if isinstance(payload, dict):
        return "\n".join(f"{k}: {_trace_text(v)}" for k, v in payload.items())
    if isinstance(payload, (list, tuple)):
        return "\n".join(_trace_text(item) for item in payload)
    return "" if payload is None else str(payload)


def _search_t1(
    terms: Sequence[str],
    surfaces: Sequence[Surface],
    days: int | None,
    now: datetime,
) -> list[RecallHit]:
    from deeptutor.services.memory import trace

    since = None
    if days is not None:
        from datetime import timedelta

        since = now - timedelta(days=days)

    out: list[RecallHit] = []
    for surface in surfaces:
        try:
            events = list(trace.iter_since(surface, since))
        except Exception:
            logger.warning("search: trace failed surface=%s", surface, exc_info=True)
            continue
        for event in events:
            text = _trace_text(event.payload)
            if not _matches(f"{event.kind}\n{text}", terms):
                continue
            out.append(
                RecallHit(
                    ref=format_ref("T1", surface, event.id),
                    layer="T1",
                    key=surface,
                    label=event.kind,
                    ts=event.ts,
                    days_ago=days_ago(event.ts, now=now),
                    snippet=_snippet(text, terms),
                )
            )
    return out


def _search_docs(
    layer: str,
    keys: Sequence[str],
    terms: Sequence[str],
    now: datetime,
) -> list[RecallHit]:
    """Search consolidated documents entry by entry.

    An L2/L3 document is a list of facts, so a match points at the document
    (the addressable unit) but the snippet shows the matching entry — enough
    for the agent to decide whether reading the whole document is worth it.
    """
    from deeptutor.services.memory import get_memory_store
    from deeptutor.services.memory.document import parse

    store = get_memory_store()
    out: list[RecallHit] = []
    for key in keys:
        try:
            raw = store.read_raw(layer, key)  # type: ignore[arg-type]
        except Exception:
            logger.warning("search: doc read failed %s/%s", layer, key, exc_info=True)
            continue
        if not raw.strip():
            continue
        try:
            doc = parse(raw)
            entries = doc.all_entries()
        except Exception:
            entries = []
        matched = [entry for entry in entries if _matches(entry.text, terms)]
        if not matched and not _matches(raw, terms):
            continue
        updated_at = _doc_updated_at(layer, key)
        body = "\n".join(entry.text for entry in matched) if matched else raw
        out.append(
            RecallHit(
                ref=format_ref(layer, key),  # type: ignore[arg-type]
                layer=layer,
                key=key,
                label=f"{layer} · {key}",
                ts=updated_at,
                days_ago=days_ago(updated_at, now=now) if updated_at else None,
                snippet=_snippet(body, terms),
            )
        )
    return out


def _doc_updated_at(layer: str, key: str) -> str:
    from deeptutor.services.memory import paths

    try:
        path = paths.l2_file(key) if layer == "L2" else paths.l3_file(key)  # type: ignore[arg-type]
        if not path.exists():
            return ""
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except Exception:
        return ""


# ── read ─────────────────────────────────────────────────────────────────


def read(refs: Iterable[str]) -> list[RecallItem]:
    """Resolve refs to their full content, in the order given.

    One bad ref does not spoil the batch: it comes back as ``found: False``
    with a reason, so a model that guessed a ref can correct just that one.
    """
    now = _now()
    out: list[RecallItem] = []
    for raw in refs:
        parsed = parse_ref(str(raw))
        if parsed is None:
            out.append(
                RecallItem(
                    ref=str(raw),
                    found=False,
                    error=(
                        "Unparseable ref. Expected L1:<surface>:<id>, "
                        "T1:<surface>:<trace_id>, L2:<surface> or L3:<slot>."
                    ),
                )
            )
            continue
        try:
            out.append(_read_one(parsed, now))
        except Exception:
            logger.warning("read failed ref=%s", raw, exc_info=True)
            out.append(RecallItem(ref=str(parsed), found=False, error="Read failed."))
    return out


def _read_one(ref: MemoryRef, now: datetime) -> RecallItem:
    if ref.layer in ("L2", "L3"):
        from deeptutor.services.memory import get_memory_store

        raw = get_memory_store().read_raw(ref.layer, ref.key)  # type: ignore[arg-type]
        if not raw.strip():
            return RecallItem(ref=str(ref), found=False, error="Document is empty or absent.")
        updated_at = _doc_updated_at(ref.layer, ref.key)
        return RecallItem(
            ref=str(ref),
            found=True,
            label=f"{ref.layer} · {ref.key}",
            ts=updated_at,
            days_ago=days_ago(updated_at, now=now) if updated_at else None,
            content=raw,
        )

    if ref.layer == "T1":
        from deeptutor.services.memory import trace

        for event in trace.iter_by_ids([ref.item]):
            return RecallItem(
                ref=str(ref),
                found=True,
                label=event.kind,
                ts=event.ts,
                days_ago=days_ago(event.ts, now=now),
                content=_trace_text(event.payload),
                metadata={"session_id": event.session_id, "turn_id": event.turn_id},
            )
        return RecallItem(ref=str(ref), found=False, error="No such trace event.")

    from deeptutor.services.memory.snapshot import adapters

    for entity in adapters.read_entities(ref.key):  # type: ignore[arg-type]
        if entity.id == ref.item:
            return RecallItem(
                ref=str(ref),
                found=True,
                label=entity.label,
                ts=entity.ts,
                days_ago=days_ago(entity.ts, now=now),
                content=entity.content,
                metadata=dict(entity.metadata),
            )
    return RecallItem(ref=str(ref), found=False, error="No such entity on this surface.")


__all__ = [
    "RecallHit",
    "RecallItem",
    "days_ago",
    "index",
    "read",
    "recent",
    "search",
]
