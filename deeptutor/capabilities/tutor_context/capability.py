"""Tutor-workspace loop capability.

Active on every turn started from the Tutor workspace that is *not* already a
Mastery Path turn. It does two things, and owns no tools:

* contributes a short system block establishing a teaching stance, and
* folds the learner's current state — what they are working through, what is
  due for review, what they recently got wrong — into the turn's user-message
  seed via the optional async ``pre_loop`` hook.

Why the second half matters: without it, "Tutor mode" would amount to a
smaller toolbar. The spaced-repetition scheduler and the mastery engine have
been accumulating a precise picture of the learner in
:mod:`deeptutor.learning` all along, and a plain chat turn never saw any of
it. Reading it back is what makes a tutoring answer land on *this* learner —
asking about the chain rule while three of their concept-type items are
overdue should not produce the same paragraph a search engine would.

Unlike :class:`~deeptutor.capabilities.explore_context.ExploreContextCapability`,
whose ``pre_loop`` runs an agentic investigation, this pre-pass performs **no
LLM call**: it reads a few JSON files and formats them. It costs nothing but
the tokens of the block it returns.
"""

from __future__ import annotations

import logging
from typing import Any

from deeptutor.capabilities.protocol import PromptBlock
from deeptutor.core.context import UnifiedContext
from deeptutor.core.stream_bus import StreamBus

logger = logging.getLogger(__name__)

# Bounded so a learner with a large backlog cannot crowd out the conversation.
_MAX_DUE = 5
_MAX_PATHS = 3

_SYSTEM_EN = """You are tutoring, not just answering.

Prefer the shortest explanation that lets the learner take the next step
themselves, and check understanding before moving on. When the learner's
current state is provided below, teach against it — connect the answer to what
they are working through and to what they recently got wrong. Never invent
progress data that was not given to you."""

_SYSTEM_ZH = """你在辅导，而不只是回答。

优先给出能让学习者自己迈出下一步的最简解释，并在推进之前确认其理解程度。当下方
提供了学习者的当前状态时，请据此教学——把回答与他们正在学习的内容、以及最近做错
的地方联系起来。绝不要编造未提供给你的进度数据。"""


def _is_zh(language: str) -> bool:
    return str(language or "en").lower().startswith("zh")


def _format_state(overview: dict[str, Any], *, zh: bool) -> str:
    """Render the learner snapshot, or "" when there is nothing worth saying."""
    due = overview.get("due") or []
    continuing = overview.get("continuing") or []
    unresolved = int(overview.get("unresolved_errors") or 0)
    if not due and not continuing and not unresolved:
        return ""

    lines: list[str] = []
    lines.append("学习者当前状态：" if zh else "Learner's current state:")

    if continuing:
        lines.append("\n正在学习：" if zh else "\nCurrently working through:")
        for item in continuing[:_MAX_PATHS]:
            lines.append(
                f"- {item.get('book_name', '')} / {item.get('module_name', '')}"
                f" ({'当前阶段' if zh else 'stage'}: {item.get('stage', '')})"
            )

    if due:
        total = int(overview.get("due_count") or len(due))
        header = f"\n到期复习（共 {total} 项）：" if zh else f"\nDue for review ({total} total):"
        lines.append(header)
        for item in due[:_MAX_DUE]:
            lines.append(
                f"- {item.get('kp_name', '')} [{item.get('knowledge_type', '')}]"
                f" — {item.get('book_name', '')}"
            )

    if unresolved:
        lines.append(
            f"\n未消化错题：{unresolved} 道" if zh else f"\nUnresolved mistakes: {unresolved}"
        )

    return "\n".join(lines)


class TutorContextCapability:
    """Learner-aware context for plain Tutor-workspace conversations."""

    name = "tutor_context"
    owned_tools: tuple[str, ...] = ()

    def is_active(self, context: UnifiedContext) -> bool:
        if str(context.metadata.get("mode") or "") != "tutor":
            return False
        # Mastery Path already owns the learner's state through its own tools
        # and playbook; a second, flatter snapshot would only compete with it.
        return not context.metadata.get("mastery_mode")

    def system_block(
        self,
        context: UnifiedContext,
        *,
        language: str,
        prompts: dict[str, Any],
    ) -> PromptBlock | None:
        _ = prompts
        if not self.is_active(context):
            return None
        return PromptBlock("tutor_stance", _SYSTEM_ZH if _is_zh(language) else _SYSTEM_EN)

    def augment_kwargs(
        self,
        tool_name: str,
        kwargs: dict[str, Any],
        context: UnifiedContext,
    ) -> dict[str, Any]:
        _ = (tool_name, context)
        return kwargs

    def pre_loop_seed(self, context: UnifiedContext) -> str:
        _ = context
        return ""

    async def pre_loop(
        self,
        context: UnifiedContext,
        stream: StreamBus,
        *,
        usage: Any | None = None,
    ) -> PromptBlock | None:
        _ = (stream, usage)  # No LLM call here, so neither is needed.
        if not self.is_active(context):
            return None
        try:
            from deeptutor.learning.service import LearningService
            from deeptutor.learning.storage import LearningStore

            overview = LearningService(LearningStore()).today_overview(limit=_MAX_DUE)
        except Exception:
            # A learner with no paths yet is the common case, and a storage
            # problem must never take down an ordinary chat turn.
            logger.warning("Failed to load learner state for tutor context", exc_info=True)
            return None

        text = _format_state(overview, zh=_is_zh(context.language))
        if not text:
            return None
        return PromptBlock("tutor_context", text)


__all__ = ["TutorContextCapability"]
