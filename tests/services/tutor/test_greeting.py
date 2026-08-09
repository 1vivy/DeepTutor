"""The Tutor opening line: caching rules and what happens when the model fails.

The load-bearing property is that a read never waits for an LLM. Everything
else here is the staleness policy that decides when a new line gets made.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import time
from typing import Any

import pytest

from deeptutor.services.tutor import greeting as g


@pytest.fixture
def tmp_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the greeting cache at an isolated directory."""
    cache = tmp_path / "tutor" / "greeting.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(g, "_cache_path", lambda: cache)
    g._inflight.clear()
    return cache


@pytest.fixture
def no_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail any LLM call, so tests cannot accidentally spend tokens."""

    async def _boom(*args: Any, **kwargs: Any):
        raise AssertionError("the LLM must not be called here")
        yield ""  # pragma: no cover - makes this an async generator

    monkeypatch.setattr("deeptutor.services.llm.stream", _boom)


def _fake_llm(monkeypatch: pytest.MonkeyPatch, reply: str) -> list[dict[str, Any]]:
    """Serve *reply* from the LLM and record the calls."""
    calls: list[dict[str, Any]] = []

    async def _stream(**kwargs: Any):
        calls.append(kwargs)
        yield reply

    monkeypatch.setattr("deeptutor.services.llm.stream", _stream)
    return calls


def _topics(monkeypatch: pytest.MonkeyPatch, topics: list[str]) -> None:
    monkeypatch.setattr(g, "_recent_topics", lambda: topics)


# ── Sanitising model output ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Let's pick up the chain rule.", "Let's pick up the chain rule."),
        ('  "Ask me about RAG!"  ', "Ask me about RAG!"),
        ("“关于链式法则，随便问我”", "关于链式法则，随便问我"),
        # Models that offer alternatives: take the first line only.
        ("Ask me about RAG!\nOr: something else", "Ask me about RAG!"),
        # Models that ignore "no prefix".
        ("Greeting: Ask me about RAG!", "Ask me about RAG!"),
        ("`Let's learn X.`", "Let's learn X."),
        # Nothing usable.
        ("", ""),
        ("   ", ""),
        # A paragraph is not an opening line.
        ("x" * 200, ""),
    ],
)
def test_sanitize(raw: str, expected: str) -> None:
    assert g._sanitize(raw) == expected


# ── Generation ──────────────────────────────────────────────────────────


def test_no_activity_skips_the_model_entirely(
    tmp_workspace: Path, no_llm: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With nothing to name, there is nothing to generate."""
    _topics(monkeypatch, [])
    result = asyncio.run(g.refresh_greeting("en"))
    assert result.text == g._fallback("en")


def test_generated_line_names_the_learner_s_topics(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _topics(monkeypatch, ["Agentic RAG", "LangGraph nodes"])
    calls = _fake_llm(monkeypatch, "Ready to nail LangGraph nodes?")

    result = asyncio.run(g.refresh_greeting("en"))

    assert result.text == "Ready to nail LangGraph nodes?"
    assert "Agentic RAG" in calls[0]["prompt"]
    assert "LangGraph nodes" in calls[0]["prompt"]


def test_language_selects_the_prompt(tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _topics(monkeypatch, ["链式法则"])
    calls = _fake_llm(monkeypatch, "关于链式法则，随便问我。")
    asyncio.run(g.refresh_greeting("zh-CN"))
    assert calls[0]["system_prompt"] == g._SYSTEM_ZH


def test_model_failure_falls_back_instead_of_raising(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _topics(monkeypatch, ["Agentic RAG"])

    async def _stream(**kwargs: Any):
        raise RuntimeError("provider down")
        yield ""  # pragma: no cover

    monkeypatch.setattr("deeptutor.services.llm.stream", _stream)

    result = asyncio.run(g.refresh_greeting("en"))
    assert result.text == g._fallback("en")


def test_unusable_model_output_falls_back(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _topics(monkeypatch, ["Agentic RAG"])
    _fake_llm(monkeypatch, "x" * 300)  # too long to be an opening line
    assert asyncio.run(g.refresh_greeting("en")).text == g._fallback("en")


# ── Caching / staleness ─────────────────────────────────────────────────


def test_refresh_persists_and_is_read_back(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _topics(monkeypatch, ["Agentic RAG"])
    _fake_llm(monkeypatch, "Ask me about Agentic RAG!")
    asyncio.run(g.refresh_greeting("en"))

    cached = g._load()
    assert cached is not None
    assert cached.text == "Ask me about Agentic RAG!"


def test_a_fresh_line_is_not_stale(tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _topics(monkeypatch, ["Agentic RAG"])
    _fake_llm(monkeypatch, "Ask me about Agentic RAG!")
    asyncio.run(g.refresh_greeting("en"))
    assert g._is_stale(g._load(), "en") is False


def test_changed_activity_makes_it_stale(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """New material is exactly when the *content* should change."""
    _topics(monkeypatch, ["Agentic RAG"])
    _fake_llm(monkeypatch, "Ask me about Agentic RAG!")
    asyncio.run(g.refresh_greeting("en"))

    _topics(monkeypatch, ["Agentic RAG", "The chain rule"])
    assert g._is_stale(g._load(), "en") is True


def test_age_makes_it_stale(tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Even unchanged material should not greet someone all week."""
    _topics(monkeypatch, ["Agentic RAG"])
    _fake_llm(monkeypatch, "Ask me about Agentic RAG!")
    asyncio.run(g.refresh_greeting("en"))

    aged = g.Greeting(
        text="Ask me about Agentic RAG!",
        language="en",
        generated_at=time.time() - g._TTL_SECONDS - 1,
        fingerprint=g._fingerprint(["Agentic RAG"], "en"),
    )
    g._save(aged)
    assert g._is_stale(g._load(), "en") is True


def test_switching_language_makes_it_stale(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _topics(monkeypatch, ["Agentic RAG"])
    _fake_llm(monkeypatch, "Ask me about Agentic RAG!")
    asyncio.run(g.refresh_greeting("en"))
    assert g._is_stale(g._load(), "zh") is True


def test_missing_cache_is_stale(tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _topics(monkeypatch, ["Agentic RAG"])
    assert g._is_stale(None, "en") is True


def test_corrupt_cache_reads_as_absent(tmp_workspace: Path) -> None:
    tmp_workspace.write_text("{not json", encoding="utf-8")
    assert g._load() is None


# ── Reads never wait for the model ──────────────────────────────────────


def test_a_stale_read_returns_the_old_line_immediately(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Stale-while-revalidate: the caller is never blocked on generation."""
    _topics(monkeypatch, ["Agentic RAG"])
    _fake_llm(monkeypatch, "Ask me about Agentic RAG!")
    asyncio.run(g.refresh_greeting("en"))

    # New material → the cached line is now stale.
    _topics(monkeypatch, ["Agentic RAG", "The chain rule"])
    scheduled: list[str] = []
    monkeypatch.setattr(g, "_schedule_refresh", lambda language: scheduled.append(language))

    result = asyncio.run(g.get_greeting("en"))

    assert result["text"] == "Ask me about Agentic RAG!"  # the old one, at once
    assert result["stale"] is True
    assert scheduled == ["en"]  # and a new one was queued


def test_an_empty_cache_read_returns_a_fallback_not_nothing(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _topics(monkeypatch, ["Agentic RAG"])
    monkeypatch.setattr(g, "_schedule_refresh", lambda language: None)
    result = asyncio.run(g.get_greeting("en"))
    assert result["text"] == g._fallback("en")
    assert result["stale"] is True


def test_a_fresh_read_schedules_nothing(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _topics(monkeypatch, ["Agentic RAG"])
    _fake_llm(monkeypatch, "Ask me about Agentic RAG!")
    asyncio.run(g.refresh_greeting("en"))

    scheduled: list[str] = []
    monkeypatch.setattr(g, "_schedule_refresh", lambda language: scheduled.append(language))
    result = asyncio.run(g.get_greeting("en"))

    assert result["stale"] is False
    assert scheduled == []


def test_concurrent_reads_trigger_one_generation(
    tmp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A burst of page loads must not fan out into a burst of LLM calls."""
    _topics(monkeypatch, ["Agentic RAG"])
    calls = _fake_llm(monkeypatch, "Ask me about Agentic RAG!")

    async def scenario() -> None:
        await asyncio.gather(*(g.get_greeting("en") for _ in range(5)))
        # Let the single scheduled task run to completion.
        pending = [task for task in g._inflight.values() if not task.done()]
        await asyncio.gather(*pending)

    asyncio.run(scenario())
    assert len(calls) == 1
