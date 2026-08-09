"""Reading memory back: addressing, recency, and search.

Two things here are worth more than the rest. Ref parsing is the boundary
between a model-authored string and the filesystem, so it is tested for what it
*rejects*. And ``days_ago`` is the number a tutor's judgement of relevance
rests on, so it is tested at its edges rather than assumed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from deeptutor.services.memory import paths, recall, store
from deeptutor.services.memory.refs import format_ref, parse_ref
from deeptutor.services.memory.snapshot import adapters
from deeptutor.services.memory.snapshot import store as snap_store
from deeptutor.services.memory.snapshot.entity import Entity


@pytest.fixture
def tmp_memory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "memory"
    monkeypatch.setattr(paths, "memory_root", lambda: root)
    monkeypatch.setattr(snap_store, "memory_root", lambda: root)
    monkeypatch.setattr(store, "_singleton", None)
    paths.ensure_dirs()
    return root


def _iso(days_ago: float) -> str:
    return (datetime.now(tz=timezone.utc) - timedelta(days=days_ago)).isoformat()


def _fake_surface(monkeypatch: pytest.MonkeyPatch, surface: str, entities: list[Entity]) -> None:
    """Serve ``entities`` for one surface and nothing for the others."""
    original = adapters.read_entities

    def _read(name: str) -> list[Entity]:
        if name == surface:
            return entities
        return [] if name in adapters.SUPPORTED_SURFACES else original(name)

    monkeypatch.setattr(adapters, "read_entities", _read)
    monkeypatch.setattr(adapters, "_PROBES", {})


# ── Ref addressing ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,layer,key,item",
    [
        ("L1:chat:unified_123", "L1", "chat", "unified_123"),
        ("T1:kb:kb:01KRX", "T1", "kb", "kb:01KRX"),  # trace ids contain a colon
        ("L1:quiz:sess-1:q-2", "L1", "quiz", "sess-1:q-2"),  # so do quiz ids
        ("L2:chat", "L2", "chat", ""),
        ("L3:profile", "L3", "profile", ""),
        ("  L2:book  ", "L2", "book", ""),
    ],
)
def test_parse_ref_accepts_valid_forms(raw: str, layer: str, key: str, item: str) -> None:
    parsed = parse_ref(raw)
    assert parsed is not None
    assert (parsed.layer, parsed.key, parsed.item) == (layer, key, item)


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "chat:unified_123",  # no layer
        "L4:chat:x",  # unknown layer
        "L1:notasurface:x",  # unknown surface
        "L3:notaslot",  # unknown slot
        "L1:chat",  # item layer without an item
        "T1:chat",
        "L2:chat:extra",  # document layer with a spurious item
        "L3:profile:extra",
        "L1:../../etc:passwd",  # traversal attempt lands on the surface check
        "L2:../../secrets",
    ],
)
def test_parse_ref_rejects_everything_else(raw: str) -> None:
    assert parse_ref(raw) is None


def test_ref_roundtrips_through_format() -> None:
    for raw in ("L1:chat:abc", "T1:kb:kb:01X", "L2:quiz", "L3:scope"):
        parsed = parse_ref(raw)
        assert parsed is not None
        assert str(parsed) == raw
        assert format_ref(parsed.layer, parsed.key, parsed.item) == raw


# ── days_ago ─────────────────────────────────────────────────────────────


def test_days_ago_counts_whole_days() -> None:
    now = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)
    assert recall.days_ago(now.isoformat(), now=now) == 0
    assert recall.days_ago((now - timedelta(hours=23)).isoformat(), now=now) == 0
    assert recall.days_ago((now - timedelta(hours=25)).isoformat(), now=now) == 1
    assert recall.days_ago((now - timedelta(days=30)).isoformat(), now=now) == 30


def test_days_ago_clamps_future_stamps_to_today() -> None:
    """Clock skew between a writer and this process must not read as negative."""
    now = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)
    assert recall.days_ago((now + timedelta(hours=6)).isoformat(), now=now) == 0


def test_days_ago_is_none_for_unusable_stamps() -> None:
    for value in ("", "not a date", "2026-13-45"):
        assert recall.days_ago(value) is None


def test_days_ago_treats_naive_stamps_as_utc() -> None:
    now = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)
    assert recall.days_ago("2026-08-07T12:00:00", now=now) == 2


# ── recent ───────────────────────────────────────────────────────────────


def test_recent_orders_newest_first_and_bounds_the_window(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_surface(
        monkeypatch,
        "chat",
        [
            Entity(id="old", label="Old", ts=_iso(10), content="x"),
            Entity(id="today", label="Today", ts=_iso(0.1), content="x"),
            Entity(id="yesterday", label="Yesterday", ts=_iso(1.2), content="x"),
        ],
    )
    hits = recall.recent(days=3, limit=10)
    assert [hit.label for hit in hits] == ["Today", "Yesterday"]
    assert hits[0].days_ago == 0
    assert hits[0].ref == "L1:chat:today"


def test_recent_drops_undated_items(tmp_memory: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """ "In the last three days" must not include items of unknown age.

    Search keeps undated items (some adapters cannot produce a date at all);
    a recency listing cannot, because placing them there asserts something the
    data does not support.
    """
    _fake_surface(
        monkeypatch,
        "chat",
        [
            Entity(id="dated", label="Dated", ts=_iso(0.5), content="x"),
            Entity(id="undated", label="Undated", ts="", content="x"),
        ],
    )
    assert [hit.label for hit in recall.recent(days=3)] == ["Dated"]


def test_recent_with_no_window_keeps_undated_last(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_surface(
        monkeypatch,
        "chat",
        [
            Entity(id="undated", label="Undated", ts="", content="x"),
            Entity(id="dated", label="Dated", ts=_iso(5), content="x"),
        ],
    )
    hits = recall.recent(days=None, limit=10)
    assert [hit.label for hit in hits] == ["Dated", "Undated"]


def test_recent_respects_the_limit(tmp_memory: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_surface(
        monkeypatch,
        "chat",
        [Entity(id=f"s{i}", label=f"S{i}", ts=_iso(i / 10), content="x") for i in range(30)],
    )
    assert len(recall.recent(days=30, limit=5)) == 5
    # Absurd limits are clamped, not honoured.
    assert len(recall.recent(days=30, limit=10_000)) == 30


# ── search ───────────────────────────────────────────────────────────────


def test_search_requires_every_term(tmp_memory: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_surface(
        monkeypatch,
        "chat",
        [
            Entity(id="both", label="Both", ts=_iso(1), content="agentic rag pipeline"),
            Entity(id="one", label="One", ts=_iso(1), content="agentic planning"),
        ],
    )
    hits = recall.search("agentic rag", layers=["L1"])
    assert [hit.label for hit in hits] == ["Both"]


def test_search_matches_cjk_substrings(tmp_memory: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """No tokeniser, so a CJK query has to work as a substring match."""
    _fake_surface(
        monkeypatch,
        "chat",
        [Entity(id="zh", label="链式法则", ts=_iso(1), content="我们讨论了链式法则的推导")],
    )
    assert [hit.label for hit in recall.search("链式法则", layers=["L1"])] == ["链式法则"]


def test_search_matches_the_label_too(tmp_memory: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_surface(
        monkeypatch,
        "chat",
        [Entity(id="t", label="Chain rule review", ts=_iso(1), content="unrelated body")],
    )
    assert len(recall.search("chain rule", layers=["L1"])) == 1


def test_search_keeps_undated_items(tmp_memory: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_surface(
        monkeypatch,
        "chat",
        [Entity(id="u", label="Undated", ts="", content="agentic rag")],
    )
    hits = recall.search("agentic rag", layers=["L1"], days=3)
    assert [hit.label for hit in hits] == ["Undated"]
    assert hits[0].days_ago is None


def test_search_snippet_centres_on_the_match(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    body = ("filler " * 200) + "the CHAIN RULE appears here " + ("tail " * 200)
    _fake_surface(monkeypatch, "chat", [Entity(id="s", label="S", ts=_iso(1), content=body)])
    hit = recall.search("chain rule", layers=["L1"])[0]
    assert "CHAIN RULE" in hit.snippet
    assert hit.snippet.startswith("…")


def test_search_honours_the_surface_filter(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_surface(monkeypatch, "chat", [Entity(id="c", label="C", ts=_iso(1), content="rag")])
    assert recall.search("rag", layers=["L1"], surfaces=["quiz"]) == []
    assert len(recall.search("rag", layers=["L1"], surfaces=["chat"])) == 1


def test_search_reads_l2_and_l3_documents(tmp_memory: Path) -> None:
    (tmp_memory / "L2" / "chat.md").write_text(
        "# Chat\n\n## Topics\n- The learner studied Agentic RAG closely.\n",
        encoding="utf-8",
    )
    (tmp_memory / "L3" / "profile.md").write_text(
        "# Profile\n\n## Identity\n- Works on Agentic RAG systems.\n",
        encoding="utf-8",
    )
    refs = {hit.ref for hit in recall.search("agentic rag", layers=["L2", "L3"])}
    assert refs == {"L2:chat", "L3:profile"}


# ── read ─────────────────────────────────────────────────────────────────


def test_read_resolves_documents_and_entities(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_memory / "L3" / "scope.md").write_text("# Scope\n\n- Linear algebra\n", encoding="utf-8")
    _fake_surface(
        monkeypatch,
        "chat",
        [Entity(id="abc", label="A chat", ts=_iso(2), content="the full transcript")],
    )

    items = recall.read(["L3:scope", "L1:chat:abc"])
    assert [item.found for item in items] == [True, True]
    assert "Linear algebra" in items[0].content
    assert items[1].content == "the full transcript"
    assert items[1].days_ago == 2


def test_read_reports_each_bad_ref_without_spoiling_the_batch(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_surface(monkeypatch, "chat", [Entity(id="ok", label="OK", ts=_iso(1), content="body")])
    items = recall.read(["nonsense", "L1:chat:missing", "L1:chat:ok", "L2:book"])

    assert [item.found for item in items] == [False, False, True, False]
    assert "Unparseable" in items[0].error
    assert "No such entity" in items[1].error
    assert "empty or absent" in items[3].error


def test_read_preserves_the_requested_order(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_surface(
        monkeypatch,
        "chat",
        [
            Entity(id="a", label="A", ts=_iso(1), content="first"),
            Entity(id="b", label="B", ts=_iso(2), content="second"),
        ],
    )
    items = recall.read(["L1:chat:b", "L1:chat:a"])
    assert [item.content for item in items] == ["second", "first"]


# ── index ────────────────────────────────────────────────────────────────


def test_index_reports_surfaces_and_documents(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_surface(
        monkeypatch,
        "chat",
        [Entity(id="a", label="A", ts=_iso(0.2), content="x")],
    )
    (tmp_memory / "L2" / "chat.md").write_text("# Chat\n\n- A fact.\n", encoding="utf-8")

    out = recall.index()
    chat_l1 = [row for row in out["L1"] if row["surface"] == "chat"]
    assert chat_l1 and chat_l1[0]["entities"] == 1
    assert chat_l1[0]["latest_days_ago"] == 0
    # Never consolidated, so the one entity is outstanding.
    assert chat_l1[0]["unconsolidated"] == 1

    chat_l2 = [row for row in out["L2"] if row["surface"] == "chat"]
    assert chat_l2 and chat_l2[0]["exists"] is True
    assert chat_l2[0]["ref"] == "L2:chat"
    assert {row["slot"] for row in out["L3"]} == set(paths.L3_SLOTS)


def test_index_omits_surfaces_with_nothing_in_them(
    tmp_memory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_surface(monkeypatch, "chat", [])
    assert recall.index()["L1"] == []
