"""The Tutor workspace's opening line.

``Good morning.`` tells the learner nothing they did not already know. This
generates the line from what they have actually been working on — "Ask me
anything about Agentic RAG!", "Let's pick up the chain rule." — so arriving in
Tutor names the thread they were pulling on.

Never on the request path
-------------------------
An LLM call is far too slow to sit between a click and a rendered page, and a
greeting is worth approximately zero waiting. So reads are
stale-while-revalidate: :func:`get_greeting` returns whatever is cached
immediately — even if stale, even if empty — and schedules the regeneration in
the background. The next visit gets the new line. That is what "when the system
is idle" means in practice: nobody is ever blocked on it.

When it regenerates
-------------------
Two triggers, both cheap to evaluate:

* the learner's recent activity changed (a fingerprint over the labels), which
  is when the *content* should change;
* or the line is older than :data:`_TTL_SECONDS`, which is when the *wording*
  should change so the same sentence does not greet someone all week.

A manual refresh (the button next to the line) bypasses both and regenerates
synchronously, because there a human is deliberately waiting for a new one.
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
import hashlib
import json
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

# Long enough that the same line is not re-generated all afternoon, short
# enough that it feels responsive to a day's work.
_TTL_SECONDS = 6 * 3600
# The greeting reads as one glance; anything longer is a paragraph.
_MAX_CHARS = 80
_LLM_TIMEOUT = 15.0
# How much history shapes the line. A week matches the Daily page's default.
_LOOKBACK_DAYS = 7
_MAX_TOPICS = 8

# One in-flight regeneration per scope; a burst of page loads must not fan out
# into a burst of LLM calls.
_inflight: dict[str, asyncio.Task[Any]] = {}


@dataclass(frozen=True, slots=True)
class Greeting:
    """A generated opening line plus what it was generated from."""

    text: str
    language: str
    generated_at: float
    fingerprint: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _cache_path():
    from deeptutor.services.path_service import get_path_service

    directory = get_path_service().get_workspace_dir() / "tutor"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "greeting.json"


def _scope_key() -> str:
    try:
        return str(_cache_path())
    except Exception:  # pragma: no cover - defensive
        return "<unresolved>"


def _load() -> Greeting | None:
    try:
        path = _cache_path()
        if not path.exists():
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        text = str(raw.get("text") or "").strip()
        if not text:
            return None
        return Greeting(
            text=text,
            language=str(raw.get("language") or "en"),
            generated_at=float(raw.get("generated_at") or 0.0),
            fingerprint=str(raw.get("fingerprint") or ""),
        )
    except Exception:
        logger.debug("greeting cache unreadable", exc_info=True)
        return None


def _save(greeting: Greeting) -> None:
    try:
        path = _cache_path()
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(greeting.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(path)
    except Exception:
        logger.debug("greeting cache unwritable", exc_info=True)


# ── What the line is made of ─────────────────────────────────────────────


def _recent_topics() -> list[str]:
    """Labels of what the learner has touched lately, newest first.

    Reads through the same recall service the Daily page and the tutor's own
    ``memory_search`` use, so the greeting cannot name something the tutor
    would not recognise.
    """
    topics: list[str] = []
    try:
        from deeptutor.services.memory import recall

        for hit in recall.recent(days=_LOOKBACK_DAYS, limit=_MAX_TOPICS * 2):
            label = (hit.label or "").strip()
            if label and label not in topics:
                topics.append(label)
    except Exception:
        logger.debug("greeting: recall failed", exc_info=True)

    try:
        from deeptutor.api.routers.mastery_path import get_learning_service

        overview = get_learning_service().today_overview(limit=_MAX_TOPICS)
        for item in overview.get("due") or []:
            name = str(item.get("kp_name") or "").strip()
            if name and name not in topics:
                # Due review items lead: they are the most actionable thing a
                # tutor could open on.
                topics.insert(0, name)
    except Exception:
        logger.debug("greeting: learning state failed", exc_info=True)

    return topics[:_MAX_TOPICS]


def _fingerprint(topics: list[str], language: str) -> str:
    digest = hashlib.sha1(usedforsecurity=False)
    digest.update(language.encode("utf-8"))
    for topic in topics:
        digest.update(b"\0")
        digest.update(topic.encode("utf-8"))
    return digest.hexdigest()[:16]


_SYSTEM_EN = """You write the single opening line a tutoring app shows its learner.

Rules:
- ONE short sentence, under 12 words. No greeting words ("Hello", "Good morning").
- Name something concrete from the learner's recent work.
- Invite them in: "Ask me anything about X!", "Let's pick up X.", "Ready to nail X?"
- Plain text only. No quotes, no markdown, no emoji.
- If the material is thin, write a warm generic invitation instead of inventing a topic."""

_SYSTEM_ZH = """你要为一个辅导应用写出展示给学习者的开场一句话。

规则：
- 只写一句短句，不超过 20 个字。不要问候语（"你好"、"早上好"）。
- 点出学习者最近学的某个具体内容。
- 语气是邀请："关于 X，随便问我"、"我们接着看 X 吧"、"今天把 X 拿下？"
- 纯文本。不要引号、不要 Markdown、不要 emoji。
- 如果素材太少，就写一句温和的通用邀请，不要编造话题。"""


def _fallback(language: str) -> str:
    return "有什么想学的，随时问我。" if _is_zh(language) else "Ask me anything you're working on."


def _is_zh(language: str) -> bool:
    return str(language or "en").lower().startswith("zh")


def _sanitize(raw: str) -> str:
    """One clean line, or "" if the model produced nothing usable."""
    text = (raw or "").strip()
    if not text:
        return ""
    # Take the first non-empty line; models sometimes offer alternatives.
    for line in text.splitlines():
        candidate = line.strip().strip("`").strip()
        if candidate:
            text = candidate
            break
    text = text.strip().strip('"').strip("'").strip("“”‘’").strip()
    # A model that ignored "no prefix" and wrote ``Greeting: ...``.
    for prefix in ("greeting:", "line:", "开场语：", "问候语："):
        if text.lower().startswith(prefix):
            text = text[len(prefix) :].strip()
    if len(text) > _MAX_CHARS:
        return ""
    return text


async def _generate(language: str) -> Greeting:
    """Call the model. Always returns a Greeting — falls back on any failure."""
    topics = _recent_topics()
    fingerprint = _fingerprint(topics, language)
    zh = _is_zh(language)

    if not topics:
        return Greeting(
            text=_fallback(language),
            language=language,
            generated_at=time.time(),
            fingerprint=fingerprint,
        )

    listed = "\n".join(f"- {topic}" for topic in topics)
    user_prompt = (
        f"学习者最近接触的内容：\n{listed}\n\n请写出那一句开场语。"
        if zh
        else f"The learner has recently been working on:\n{listed}\n\nWrite the opening line."
    )

    text = ""
    try:
        from deeptutor.services.llm import stream as llm_stream

        async def _collect() -> str:
            chunks: list[str] = []
            async for chunk in llm_stream(
                prompt=user_prompt,
                system_prompt=_SYSTEM_ZH if zh else _SYSTEM_EN,
                temperature=0.8,  # a greeting may vary; this is not a fact
                max_tokens=60,
            ):
                chunks.append(chunk)
            return "".join(chunks)

        text = _sanitize(await asyncio.wait_for(_collect(), timeout=_LLM_TIMEOUT))
    except asyncio.TimeoutError:
        logger.debug("greeting LLM call timed out")
    except Exception:
        logger.debug("greeting LLM call failed", exc_info=True)

    return Greeting(
        text=text or _fallback(language),
        language=language,
        generated_at=time.time(),
        fingerprint=fingerprint,
    )


# ── Public API ───────────────────────────────────────────────────────────


def _is_stale(cached: Greeting | None, language: str) -> bool:
    if cached is None:
        return True
    if cached.language != language:
        return True
    if time.time() - cached.generated_at > _TTL_SECONDS:
        return True
    # Cheap: reads stamps, not content.
    return cached.fingerprint != _fingerprint(_recent_topics(), language)


async def refresh_greeting(language: str = "en") -> Greeting:
    """Generate a new line now and cache it. For the manual refresh button."""
    greeting = await _generate(language)
    _save(greeting)
    return greeting


def _schedule_refresh(language: str) -> None:
    """Regenerate in the background, at most one at a time per scope."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    key = _scope_key()
    pending = _inflight.get(key)
    if pending is not None and not pending.done():
        return

    async def _go() -> None:
        try:
            await refresh_greeting(language)
        except Exception:
            logger.debug("background greeting refresh failed", exc_info=True)
        finally:
            if _inflight.get(key) is task:
                _inflight.pop(key, None)

    task = loop.create_task(_go())
    _inflight[key] = task


async def get_greeting(language: str = "en") -> dict[str, Any]:
    """The line to show now, plus whether a fresher one is being made.

    Returns immediately. When the cache is stale (or absent) the caller still
    gets something to render — the last line, or a fallback — while the real
    one is generated in the background.
    """
    cached = _load()
    stale = _is_stale(cached, language)
    if stale:
        _schedule_refresh(language)

    if cached is not None and cached.language == language:
        return {**cached.to_dict(), "stale": stale}
    return {
        "text": _fallback(language),
        "language": language,
        "generated_at": 0.0,
        "fingerprint": "",
        "stale": True,
    }


__all__ = ["Greeting", "get_greeting", "refresh_greeting"]
