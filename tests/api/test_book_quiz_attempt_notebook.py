from __future__ import annotations

import asyncio
from types import SimpleNamespace

from fastapi import FastAPI
from starlette.testclient import TestClient

from deeptutor.api.routers import book as book_router
from deeptutor.book.models import Progress
import deeptutor.services.session as session_package
from deeptutor.services.session.sqlite_store import SQLiteSessionStore


class _FakeLearningStore:
    def __init__(self) -> None:
        self.saved: list[Progress] = []

    def load_progress(self, book_id: str) -> Progress:
        return Progress(book_id=book_id)

    def save_progress(self, progress: Progress) -> None:
        self.saved.append(progress)


class _FakeResolvedBook:
    def __init__(self) -> None:
        question = {
            "question_id": "q1",
            "question": "Which chapter?",
            "question_type": "choice",
            "options": {"A": "One", "B": "Two"},
            "correct_answer": "B",
            "explanation": "The book has two chapters.",
            "difficulty": "easy",
        }
        block = SimpleNamespace(
            title="Focus check",
            payload={"questions": [question]},
        )
        self.page = SimpleNamespace(
            id="page-1",
            title="Page 1",
            chapter_id="",
            block_by_id=lambda _: block,
        )
        self.book = SimpleNamespace(title="Compiled Book")
        self.engine = SimpleNamespace(
            load_book=lambda _: self.book,
            list_pages=lambda _: [self.page],
        )
        self.learning = _FakeLearningStore()

    def load_progress(self, book_id: str) -> Progress:
        return self.learning.load_progress(book_id)


def test_quiz_attempt_syncs_focus_check_to_question_bank(tmp_path, monkeypatch) -> None:
    store = SQLiteSessionStore(db_path=tmp_path / "sessions.db")
    resolved = _FakeResolvedBook()
    monkeypatch.setattr(book_router, "_resolve_book_or_404", lambda _: resolved)
    monkeypatch.setattr(session_package, "get_sqlite_session_store", lambda: store)

    app = FastAPI()
    app.include_router(book_router.router, prefix="/api/v1/book")

    payload = {
        "book_id": "book-1",
        "page_id": "page-1",
        "block_id": "block-1",
        "question_id": "q1",
        "user_answer": "A",
        "is_correct": False,
    }
    with TestClient(app) as client:
        response = client.post("/api/v1/book/books/quiz-attempt", json=payload)

    assert response.status_code == 200
    assert len(resolved.learning.saved) == 1
    entries = asyncio.run(store.list_notebook_entries(source="immersive_reading"))
    assert entries["total"] == 1
    entry = entries["items"][0]
    assert entry["session_id"] == "book_book-1"
    assert entry["session_title"] == "Compiled Book"
    assert entry["question"] == "Which chapter?"
    assert entry["source"] == "immersive_reading"
    assert entry["material_id"] == "book-1"
    assert entry["material_title"] == "Compiled Book"
    assert entry["section_id"] == "page-1"
    assert entry["section_title"] == "Page 1"
    assert entry["score_trend"] == "new"
    assert entry["resolved"] is False
