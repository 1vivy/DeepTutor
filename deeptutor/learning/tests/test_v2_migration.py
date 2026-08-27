from __future__ import annotations

import hashlib
import json
from pathlib import Path

from deeptutor.learning.migration import prepare_mastery_v2_root
from deeptutor.learning.models import LearningProgress, MasteryInteraction, PendingQuestion
from deeptutor.learning.storage import LearningStore


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def test_workspace_v1_is_archived_then_copied_into_v2_store(tmp_path: Path) -> None:
    learning_root = tmp_path / "learning"
    old_store = LearningStore(root=learning_root)
    old_store.save(LearningProgress(book_id="topic-one", name="Calculus"))
    old_store.bind_session("topic-one", "session-one")

    question = PendingQuestion(
        question_id="q-one",
        knowledge_point_id="kp-one",
        prompt="What is a limit?",
        expected_answer="A value approached by a function.",
    )
    old_store.mutate(
        "topic-one",
        lambda tx: tx.put_interaction(
            MasteryInteraction(
                interaction_id="q-one",
                path_id="topic-one",
                question=question,
            )
        ),
    )
    legacy_json = learning_root / ".legacy" / "older-topic.json"
    legacy_json.parent.mkdir(parents=True)
    legacy_json.write_text('{"legacy": true}', encoding="utf-8")

    old_db_hash = _sha256(learning_root / "mastery.sqlite3")
    v2_root = prepare_mastery_v2_root(learning_root)

    assert v2_root == learning_root / "mastery"
    assert not (learning_root / "mastery.sqlite3").exists()
    assert not (learning_root / ".legacy").exists()

    archives = sorted((learning_root / "archive").glob("v1-*"))
    assert len(archives) == 1
    archive = archives[0]
    archived_db = archive / "mastery.sqlite3"
    assert archived_db.exists()
    assert _sha256(archived_db) == old_db_hash
    assert (archive / "legacy-json" / "older-topic.json").exists()

    manifest = json.loads((archive / "migration.json").read_text(encoding="utf-8"))
    assert manifest["format_version"] == 2
    assert manifest["database_sha256"] == old_db_hash
    assert manifest["row_counts"]["mastery_paths"] == 1
    assert manifest["row_counts"]["mastery_path_sessions"] == 1
    assert manifest["row_counts"]["mastery_interactions"] == 1
    assert manifest["legacy_json_count"] == 1

    migrated = LearningStore(root=v2_root)
    assert migrated.load("topic-one").name == "Calculus"
    assert migrated.list_session_ids("topic-one") == ["session-one"]
    assert migrated.get_interaction("topic-one", "q-one") is not None


def test_v2_initialization_is_idempotent_and_never_reads_archive(tmp_path: Path) -> None:
    learning_root = tmp_path / "learning"
    old_store = LearningStore(root=learning_root)
    old_store.save(LearningProgress(book_id="topic-one"))

    v2_root = prepare_mastery_v2_root(learning_root)
    archive = next((learning_root / "archive").glob("v1-*"))
    archived_db = archive / "mastery.sqlite3"
    archived_db.write_bytes(b"backup-only")

    assert prepare_mastery_v2_root(learning_root) == v2_root
    assert LearningStore(root=v2_root).exists("topic-one") is True
    assert archived_db.read_bytes() == b"backup-only"


def test_empty_workspace_uses_v2_directory_without_creating_archive(tmp_path: Path) -> None:
    learning_root = tmp_path / "learning"

    v2_root = prepare_mastery_v2_root(learning_root)
    store = LearningStore(root=v2_root)
    store.save(LearningProgress(book_id="fresh-topic"))

    assert store.db_path == learning_root / "mastery" / "mastery.sqlite3"
    assert not (learning_root / "archive").exists()
