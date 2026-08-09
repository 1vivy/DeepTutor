"""Automatic memory upkeep: what it reconciles, and when it declines to.

The load-bearing test here is :func:`test_probe_matches_full_read_when_ids_and_timestamps_disagree`.
Everything else in the autopilot is scheduling policy; that one guards the
invariant the whole fast path rests on — a probe and a full read must never
disagree about whether something changed, or automatic refreshes would log
phantom modifications forever.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sqlite3

import pytest

from deeptutor.services.memory import autopilot, paths
from deeptutor.services.memory.snapshot import adapters
from deeptutor.services.memory.snapshot import store as snap_store

_CHAT_SCHEMA = """
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at REAL,
    updated_at REAL
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    role TEXT,
    content TEXT,
    capability TEXT DEFAULT '',
    created_at REAL
);
CREATE TABLE notebook_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT, turn_id TEXT, question_id TEXT, question TEXT,
    question_type TEXT, options_json TEXT, correct_answer TEXT,
    explanation TEXT, difficulty TEXT, user_answer TEXT,
    is_correct INTEGER, bookmarked INTEGER, created_at REAL
);
"""


@pytest.fixture
def tmp_memory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolate every memory path, including the snapshot store's own binding.

    ``snapshot.store`` imports ``memory_root`` by value, so patching
    ``paths.memory_root`` alone would leave snapshot writes pointing at the
    real user's memory directory.
    """
    root = tmp_path / "memory"
    monkeypatch.setattr(paths, "memory_root", lambda: root)
    monkeypatch.setattr(snap_store, "memory_root", lambda: root)
    paths.ensure_dirs()
    autopilot.reset_state_for_tests()
    return root


@pytest.fixture
def chat_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A chat history DB the snapshot adapters will read."""
    db = tmp_path / "chat.db"
    with sqlite3.connect(db) as conn:
        conn.executescript(_CHAT_SCHEMA)

    class _PS:
        def get_chat_history_db(self) -> Path:
            return db

    monkeypatch.setattr(adapters, "get_path_service", lambda: _PS())
    return db


def _add_session(db: Path, sid: str, title: str, updated_at: float) -> None:
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (sid, title, updated_at, updated_at),
        )


def _add_message(db: Path, sid: str, body: str, created_at: float) -> int:
    with sqlite3.connect(db) as conn:
        cur = conn.execute(
            "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (sid, "user", body, created_at),
        )
        return int(cur.lastrowid or 0)


def _settings(monkeypatch: pytest.MonkeyPatch, **overrides) -> None:
    """Install autopilot settings without touching the user's config file."""
    from deeptutor.services.memory import settings as settings_mod

    base = {
        "snapshot": "auto",
        "consolidate": "manual",
        "debounce_seconds": 1,
        "consolidate_after": 20,
        "consolidate_cooldown_seconds": 900,
    }
    base.update(overrides)
    autopilot_settings = settings_mod.AutopilotSettings(**base)
    memory_settings = settings_mod.MemorySettings(autopilot=autopilot_settings)
    monkeypatch.setattr(autopilot, "load_memory_settings", lambda: memory_settings)


# ── The invariant the fast path rests on ─────────────────────────────────


def test_probe_matches_full_read_when_ids_and_timestamps_disagree(
    chat_db: Path,
) -> None:
    """A probe must fingerprint the same message the full read picks.

    ``read_chat_entities`` takes the last message under
    ``ORDER BY created_at ASC, id ASC``. A probe using ``MAX(id)`` would agree
    on tidy data and diverge exactly here: a row inserted later (higher id)
    but timestamped earlier — a backfill, a clock stepping back, an import.
    """
    _add_session(chat_db, "s1", "Session one", updated_at=1000.0)
    _add_message(chat_db, "s1", "second by time, first by id", created_at=200.0)
    # Higher id, EARLIER timestamp: MAX(id) and the real ordering disagree.
    _add_message(chat_db, "s1", "first by time, second by id", created_at=100.0)

    full = {e.id: (e.label, e.fingerprint) for e in adapters.read_entities("chat")}
    probed = {e.id: (e.label, e.fingerprint) for e in adapters.read_stamps("chat")}

    assert probed == full


def test_probe_and_full_read_agree_on_empty_and_messageless_sessions(
    chat_db: Path,
) -> None:
    _add_session(chat_db, "empty", "No messages", updated_at=10.0)
    _add_session(chat_db, "one", "Has one", updated_at=20.0)
    _add_message(chat_db, "one", "hi", created_at=15.0)

    full = {e.id: e.fingerprint for e in adapters.read_entities("chat")}
    probed = {e.id: e.fingerprint for e in adapters.read_stamps("chat")}
    assert probed == full
    assert set(probed) == {"empty", "one"}


def test_probe_falls_back_to_full_read_when_it_raises(
    chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A broken probe must degrade to slow-but-correct, not to "empty".

    An empty surface would diff as "every entity was removed" and the
    autopilot would happily log that.
    """
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)
    _add_message(chat_db, "s1", "hello", created_at=1.0)

    def _boom() -> list:
        raise RuntimeError("probe exploded")

    monkeypatch.setitem(adapters._PROBES, "chat", _boom)
    stamps = adapters.read_stamps("chat")
    assert [s.id for s in stamps] == ["s1"]


def test_stamps_skip_content_for_surfaces_without_a_probe(chat_db: Path) -> None:
    """Fallback projection still yields the diff-shaped view."""
    stamps = adapters.read_stamps("quiz")
    assert stamps == []


# ── Scheduling policy ────────────────────────────────────────────────────


def test_manual_mode_does_no_work(
    tmp_memory: Path, chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _settings(monkeypatch, snapshot="manual", consolidate="manual")
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)

    report = asyncio.run(autopilot.run_upkeep(reason="test"))

    assert report.skipped == "disabled"
    assert not report.did_work
    # Nothing persisted: a manual-mode user's state file must not appear.
    assert not (tmp_memory / "snapshot" / "chat" / "state.json").exists()


def test_auto_mode_commits_pending_changes(
    tmp_memory: Path, chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point: a new conversation lands in L1 with nobody clicking."""
    _settings(monkeypatch, snapshot="auto")
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)
    _add_message(chat_db, "s1", "hello", created_at=1.0)

    from deeptutor.services.memory import snapshot as snap

    assert len(snap.pending_changes("chat")) == 1

    report = asyncio.run(autopilot.run_upkeep(reason="test"))

    assert "chat" in report.surfaces_refreshed
    assert report.changes == 1
    assert snap.pending_changes("chat") == []
    assert snap.current_state("chat")["last_refresh"]


def test_idle_upkeep_reports_no_surfaces(
    tmp_memory: Path, chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _settings(monkeypatch, snapshot="auto", debounce_seconds=1)
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)
    asyncio.run(autopilot.run_upkeep(reason="first"))

    autopilot.reset_state_for_tests()
    report = asyncio.run(autopilot.run_upkeep(reason="second"))

    assert report.surfaces_refreshed == ()
    assert report.changes == 0


def test_debounce_collapses_a_burst(
    tmp_memory: Path, chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _settings(monkeypatch, snapshot="auto", debounce_seconds=600)
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)

    first = asyncio.run(autopilot.run_upkeep(reason="turn-1"))
    _add_session(chat_db, "s2", "Session two", updated_at=2.0)
    second = asyncio.run(autopilot.run_upkeep(reason="turn-2"))

    assert first.surfaces_refreshed == ("chat",)
    assert second.skipped == "debounced"
    # The second session is still pending — debounced, not lost.
    from deeptutor.services.memory import snapshot as snap

    assert [c.entity_id for c in snap.pending_changes("chat")] == ["s2"]


def test_force_bypasses_debounce(
    tmp_memory: Path, chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _settings(monkeypatch, snapshot="auto", debounce_seconds=600)
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)
    asyncio.run(autopilot.run_upkeep(reason="turn-1"))
    _add_session(chat_db, "s2", "Session two", updated_at=2.0)

    report = asyncio.run(autopilot.run_upkeep(reason="explicit", force=True))

    assert report.surfaces_refreshed == ("chat",)


# ── Consolidation gating ─────────────────────────────────────────────────


def test_unconsolidated_count_ignores_entities_l2_has_seen(tmp_memory: Path, chat_db: Path) -> None:
    """The count must track ``l2_meta``, not the snapshot's pending diff.

    ``run_update`` decides what is new by comparing entity refs against
    ``seen_entity_refs``; a refresh does not touch that. Counting pending
    diffs instead would keep re-triggering consolidation for input L2 had
    already folded in.
    """
    from deeptutor.services.memory.consolidator.meta import save_l2_meta

    _add_session(chat_db, "s1", "Seen already", updated_at=1.0)
    _add_session(chat_db, "s2", "Brand new", updated_at=2.0)

    assert autopilot.unconsolidated_count("chat") == 2

    save_l2_meta("chat", seen_entity_refs={"chat:s1"})
    assert autopilot.unconsolidated_count("chat") == 1


def test_consolidate_stays_off_below_the_threshold(
    tmp_memory: Path, chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _settings(monkeypatch, snapshot="auto", consolidate="auto", consolidate_after=5)
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)

    started: list[str] = []
    monkeypatch.setattr(
        autopilot,
        "_start_l2_update",
        lambda surface: _record(started, surface),
    )

    report = asyncio.run(autopilot.run_upkeep(reason="test"))

    assert report.consolidations_started == ()
    assert started == []


def test_consolidate_fires_once_threshold_is_met(
    tmp_memory: Path, chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _settings(monkeypatch, snapshot="auto", consolidate="auto", consolidate_after=2)
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)
    _add_session(chat_db, "s2", "Session two", updated_at=2.0)

    started: list[str] = []
    monkeypatch.setattr(
        autopilot,
        "_start_l2_update",
        lambda surface: _record(started, surface),
    )

    report = asyncio.run(autopilot.run_upkeep(reason="test"))

    assert report.consolidations_started == ("chat",)
    assert started == ["chat"]


def test_consolidate_respects_its_cooldown(
    tmp_memory: Path, chat_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _settings(
        monkeypatch,
        snapshot="auto",
        consolidate="auto",
        consolidate_after=1,
        debounce_seconds=1,
        consolidate_cooldown_seconds=3600,
    )
    _add_session(chat_db, "s1", "Session one", updated_at=1.0)

    started: list[str] = []
    monkeypatch.setattr(
        autopilot,
        "_start_l2_update",
        lambda surface: _record(started, surface),
    )

    asyncio.run(autopilot.run_upkeep(reason="first"))
    _add_session(chat_db, "s2", "Session two", updated_at=2.0)
    # Only the snapshot debounce is cleared; the cooldown must still hold.
    with autopilot._state_lock:
        autopilot._last_snapshot_sync.clear()
    second = asyncio.run(autopilot.run_upkeep(reason="second"))

    assert started == ["chat"]
    assert second.consolidations_started == ()


async def _record(sink: list[str], surface: str) -> bool:
    sink.append(surface)
    return True
