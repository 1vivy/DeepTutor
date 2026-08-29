"""Task models — the LLM behind work the product does on its own.

Two calls happen without anyone asking for them: naming a conversation once it
has its first exchange, and proposing the three starting points under the home
composer. Both are short, both are frequent, and neither benefits from the
model a learner picked for their actual reasoning — a small fast model writes a
four-word title just as well and costs a fraction as much.

So each of these is a *task* that can be pointed at its own configured model.
Pointing is optional and that matters more than the feature: with nothing set
(the state every existing install is in) the scope below is a no-op, and both
call sites keep resolving exactly the LLM they resolved before — for the title
that is the model the turn itself is running on, for the starters the active
default. Nothing changes until someone chooses to change it.

Failure inherits too. A task pointing at a deleted profile, a catalog that will
not load, a malformed entry — none of that is worth failing a title over, so
every error path here falls back to the ambient config rather than raising.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import logging
from typing import Any

from deeptutor.services.config.model_catalog import LLM_TASKS, get_model_catalog_service
from deeptutor.services.llm.config import LLMConfig

from .llm import LLMSelection
from .runtime import activate_llm_selection, reset_llm_selection

logger = logging.getLogger(__name__)

TASK_SESSION_TITLE = "session_title"
TASK_STARTERS = "starters"


def _llm_tasks(catalog: dict[str, Any]) -> dict[str, Any]:
    services = catalog.get("services")
    if not isinstance(services, dict):
        return {}
    llm = services.get("llm")
    if not isinstance(llm, dict):
        return {}
    tasks = llm.get("tasks")
    return tasks if isinstance(tasks, dict) else {}


def resolve_task_selection(
    task: str,
    catalog: dict[str, Any] | None = None,
) -> LLMSelection | None:
    """Return the model a task is pinned to, or ``None`` to inherit."""
    if task not in LLM_TASKS:
        return None
    try:
        loaded = catalog if catalog is not None else get_model_catalog_service().load()
        entry = _llm_tasks(loaded).get(task)
        if not isinstance(entry, dict):
            return None
        return LLMSelection.from_payload(
            {"profile_id": entry.get("profile_id"), "model_id": entry.get("model_id")}
        )
    except Exception:
        logger.debug("Task model lookup failed for %s — inheriting", task, exc_info=True)
        return None


@contextmanager
def task_llm_scope(task: str) -> Iterator[LLMConfig | None]:
    """Install the task's LLM for the duration of the block.

    Yields the config that was installed, or ``None`` when the task inherits —
    which callers can log but never have to branch on.
    """
    selection = resolve_task_selection(task)
    if selection is None:
        yield None
        return
    try:
        config, token = activate_llm_selection(selection)
    except Exception:
        # The pointer resolved but the profile behind it no longer works.
        # Inheriting is strictly better than not writing a title at all.
        logger.debug("Task model activation failed for %s — inheriting", task, exc_info=True)
        yield None
        return
    try:
        yield config
    finally:
        reset_llm_selection(token)


__all__ = [
    "TASK_SESSION_TITLE",
    "TASK_STARTERS",
    "resolve_task_selection",
    "task_llm_scope",
]
