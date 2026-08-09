"""Tutor workspace endpoints.

Currently one: the Today feed behind the Tutor landing page.

It answers "what should I pick up now?" from two sources that were previously
unavailable together — the learner's recent activity across every surface, and
the spaced-repetition state the scheduler has been maintaining. The activity
half deliberately goes through :mod:`deeptutor.services.memory.recall`, the
same module the agent's ``memory_search`` tool uses, so the page and the tutor
are looking at one set of facts. A panel that showed the learner different
activity from what the tutor can see would be worse than no panel.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

router = APIRouter()

# Wide enough that a day's work is all visible, bounded so a heavy user's feed
# stays a page rather than a scroll.
_MAX_DAYS = 90
_MAX_ITEMS = 100


@router.get("/today")
async def today(
    days: int = Query(default=3, ge=1, le=_MAX_DAYS),
    limit: int = Query(default=24, ge=1, le=_MAX_ITEMS),
):
    """Recent activity plus learning state, in one payload.

    Never fails as a whole: each half is independent, and a learner with no
    mastery path should still see their conversations (and vice versa). A
    failure in one half returns that half empty with ``partial`` naming what
    was lost, so the page can say so instead of rendering a bare error.
    """
    partial: list[str] = []

    activity: list[dict] = []
    try:
        from deeptutor.services.memory import recall

        activity = [hit.to_dict() for hit in recall.recent(days=days, limit=limit)]
    except Exception:
        logger.warning("today: activity feed failed", exc_info=True)
        partial.append("activity")

    learning: dict = {}
    try:
        from deeptutor.api.routers.mastery_path import get_learning_service

        learning = get_learning_service().today_overview()
    except Exception:
        logger.warning("today: learning overview failed", exc_info=True)
        partial.append("learning")

    payload = {
        "days": days,
        "activity": activity,
        "learning": learning,
    }
    if partial:
        payload["partial"] = partial
    return payload


@router.get("/greeting")
async def greeting(language: str = Query(default="en")):
    """The Tutor workspace's opening line, generated from recent activity.

    Returns immediately, even when the line is stale — regeneration happens in
    the background. See :mod:`deeptutor.services.tutor.greeting`.
    """
    from deeptutor.services.tutor.greeting import get_greeting

    return await get_greeting(language)


@router.post("/greeting/refresh")
async def refresh_greeting_endpoint(language: str = Query(default="en")):
    """Generate a new opening line now. Backs the refresh button.

    Synchronous, unlike the read: a human clicked and is waiting for a
    different sentence.
    """
    from deeptutor.services.tutor.greeting import refresh_greeting

    result = await refresh_greeting(language)
    return {**result.to_dict(), "stale": False}
