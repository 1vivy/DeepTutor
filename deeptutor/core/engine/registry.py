"""Resolves which :class:`TurnEngine` drives one chat turn.

The default is always :class:`~deeptutor.core.engine.deeptutor_engine.DeepTutorEngine`
— every existing capability (chat, solve, mastery, reading, course_study, ...)
keeps running exactly as it does today. An external engine (Codex CLI or
Claude Code CLI today) is only honored for a **plain chat turn with no active
loop capability**.

That gate is not arbitrary caution: every :class:`~deeptutor.capabilities.protocol.LoopCapability`
hook — mastery's finish guard, partner_group's ``tool_round_output_policy``,
a capability's own ``system_block`` / ``pre_loop`` seed — is written against
DeepTutor's own :class:`~deeptutor.agents.chat.agent_loop.AgentLoop` running
inline, round by round. An external CLI drives its *own* loop and answers once
at the end; there is no round for those hooks to run on. So a turn that
requested an external engine but has a capability active falls back to
DeepTutor silently — the user picked an engine as their default driver, not a
capability override, and a working DeepTutor turn beats a broken one because
the session happened to also be in mastery/reading/... mode.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from deeptutor.core.engine.protocol import ENGINE_DEEPTUTOR, ENGINE_SELECTION_KEY, TurnEngine

if TYPE_CHECKING:
    from deeptutor.agents.chat.agentic_pipeline import AgenticChatPipeline
    from deeptutor.capabilities.protocol import LoopCapability
    from deeptutor.core.context import UnifiedContext
    from deeptutor.core.stream_bus import StreamBus

logger = logging.getLogger(__name__)

#: Local CLIs driven as the turn's engine instead of DeepTutor's own loop.
ENGINE_KIND_CODEX_CLI = "codex_cli"
ENGINE_KIND_CLAUDE_CODE_CLI = "claude_code_cli"

#: Every kind selectable besides the always-available default, mapped to the
#: ``SubagentBackend.kind`` that drives it. Extending this to another
#: connected CLI (Gemini, opencode, ...) is one more entry here plus that
#: backend's own ``mcp_server_url`` support (see
#: ``cli_engine.CLI_ENGINE_BACKEND_KINDS``) — nothing else changes.
EXTERNAL_ENGINE_BACKENDS: dict[str, str] = {
    ENGINE_KIND_CODEX_CLI: "codex",
    ENGINE_KIND_CLAUDE_CODE_CLI: "claude_code",
}
EXTERNAL_ENGINE_KINDS: tuple[str, ...] = tuple(EXTERNAL_ENGINE_BACKENDS)


def requested_engine_kind(context: "UnifiedContext") -> str:
    """What the turn asked for — always ``ENGINE_DEEPTUTOR`` if unset/malformed.

    Read from ``context.config_overrides`` (the composer's per-turn ``config``
    escape hatch — same channel ``subagent_consult_budget`` travels on), not
    ``context.metadata``: the engine choice is a request parameter the
    frontend sends, not turn-internal state a capability stashes mid-run.
    """
    overrides = context.config_overrides if isinstance(context.config_overrides, dict) else {}
    selection = overrides.get(ENGINE_SELECTION_KEY)
    if not isinstance(selection, dict):
        return ENGINE_DEEPTUTOR
    kind = str(selection.get("kind") or "").strip()
    return kind or ENGINE_DEEPTUTOR


def resolve_engine(
    *,
    pipeline: "AgenticChatPipeline",
    context: "UnifiedContext",
    stream: "StreamBus",
    active_loop_capabilities: tuple["LoopCapability", ...],
) -> TurnEngine:
    from deeptutor.core.engine.deeptutor_engine import DeepTutorEngine

    kind = requested_engine_kind(context)
    if kind not in EXTERNAL_ENGINE_KINDS:
        return DeepTutorEngine(pipeline=pipeline, context=context, stream=stream)

    is_plain_chat = not context.active_capability or context.active_capability == "chat"
    if active_loop_capabilities or not is_plain_chat:
        logger.info(
            "Engine '%s' requested but capability=%r (%d active loop capability/ies) "
            "is running this turn; falling back to the DeepTutor engine.",
            kind,
            context.active_capability,
            len(active_loop_capabilities),
        )
        return DeepTutorEngine(pipeline=pipeline, context=context, stream=stream)

    backend_kind = EXTERNAL_ENGINE_BACKENDS.get(kind)
    if backend_kind is not None:
        from deeptutor.core.engine.cli_engine import CliEngine

        return CliEngine(
            pipeline=pipeline, context=context, stream=stream, backend_kind=backend_kind
        )

    return DeepTutorEngine(pipeline=pipeline, context=context, stream=stream)  # pragma: no cover


__all__ = [
    "ENGINE_KIND_CODEX_CLI",
    "ENGINE_KIND_CLAUDE_CODE_CLI",
    "EXTERNAL_ENGINE_BACKENDS",
    "EXTERNAL_ENGINE_KINDS",
    "requested_engine_kind",
    "resolve_engine",
]
