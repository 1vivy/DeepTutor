"""One-way workspace migration for the Mastery Path V2 store.

V1 kept its SQLite database and lazily imported JSON files directly under the
workspace ``learning`` directory.  V2 owns a dedicated ``learning/mastery``
directory.  The migration deliberately archives first, copies the archived
database into the V2 location, and only then removes the live V1 artifacts.

Nothing in this module ever reads an existing ``learning/archive`` directory.
It is a recovery surface for humans, not a runtime fallback.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import threading
import time
import uuid

from deeptutor.services.file_io import atomic_write_text

_migration_lock = threading.RLock()
_V1_DB_NAME = "mastery.sqlite3"
_V2_DIR_NAME = "mastery"
_ARCHIVE_DIR_NAME = "archive"
_MANIFEST_NAME = "migration.json"
_COUNTED_TABLES = (
    "mastery_paths",
    "mastery_path_sessions",
    "mastery_events",
    "mastery_interactions",
    "mastery_path_leases",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _checkpoint_database(path: Path) -> None:
    """Fold a V1 WAL into the database before taking the archive copy."""

    if not path.exists():
        return
    conn = sqlite3.connect(path, timeout=30.0)
    try:
        conn.execute("PRAGMA busy_timeout = 30000")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchall()
        conn.commit()
    finally:
        conn.close()


def _row_counts(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    uri = f"file:{path.resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        existing = {
            str(row[0])
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        return {
            table: int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            for table in _COUNTED_TABLES
            if table in existing
        }
    finally:
        conn.close()


def _copy_atomic(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.parent / f".{target.name}.tmp-{uuid.uuid4().hex}"
    try:
        shutil.copy2(source, temp)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)


def _unique_archive_dir(archive_root: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    candidate = archive_root / f"v1-{stamp}"
    suffix = 1
    while candidate.exists():
        candidate = archive_root / f"v1-{stamp}-{suffix}"
        suffix += 1
    return candidate


def prepare_mastery_v2_root(learning_root: Path) -> Path:
    """Return the V2 store root, archiving/copying a V1 workspace once.

    The V2 database itself is the idempotency marker.  Once it exists this
    function returns immediately and does not enumerate, validate, or open any
    archive.  A brand-new workspace creates only the V2 directory.
    """

    root = Path(learning_root)
    v2_root = root / _V2_DIR_NAME
    v2_db = v2_root / _V1_DB_NAME
    if v2_db.exists():
        return v2_root

    with _migration_lock:
        if v2_db.exists():
            return v2_root

        root.mkdir(parents=True, exist_ok=True)
        legacy_db = root / _V1_DB_NAME
        legacy_json_dir = root / ".legacy"
        has_legacy_json = legacy_json_dir.is_dir() and any(
            path.is_file() for path in legacy_json_dir.rglob("*")
        )
        if not legacy_db.exists() and not has_legacy_json:
            v2_root.mkdir(parents=True, exist_ok=True)
            return v2_root

        archive_root = root / _ARCHIVE_DIR_NAME
        archive_dir = _unique_archive_dir(archive_root)
        archive_dir.mkdir(parents=True, exist_ok=False)
        started_at = time.time()

        archived_db: Path | None = None
        if legacy_db.exists():
            _checkpoint_database(legacy_db)
            archived_db = archive_dir / _V1_DB_NAME
            _copy_atomic(legacy_db, archived_db)
            _copy_atomic(archived_db, v2_db)
        else:
            v2_root.mkdir(parents=True, exist_ok=True)

        legacy_json_count = 0
        if has_legacy_json:
            archived_json_dir = archive_dir / "legacy-json"
            shutil.copytree(legacy_json_dir, archived_json_dir)
            legacy_json_count = sum(
                1 for path in archived_json_dir.rglob("*") if path.is_file()
            )

        manifest = {
            "format_version": 2,
            "migration": "mastery-path-v1-to-v2",
            "migrated_at": started_at,
            "source": str(root),
            "target": str(v2_root),
            "database_sha256": _sha256(archived_db) if archived_db else "",
            "row_counts": _row_counts(archived_db) if archived_db else {},
            "legacy_json_count": legacy_json_count,
        }
        atomic_write_text(
            archive_dir / _MANIFEST_NAME,
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        )

        # The archive and V2 copy are durable now.  Remove only the exact V1
        # paths; the archive remains recoverable and is never consulted again.
        legacy_db.unlink(missing_ok=True)
        (root / f"{_V1_DB_NAME}-wal").unlink(missing_ok=True)
        (root / f"{_V1_DB_NAME}-shm").unlink(missing_ok=True)
        if legacy_json_dir.exists():
            shutil.rmtree(legacy_json_dir)

        return v2_root


__all__ = ["prepare_mastery_v2_root"]

