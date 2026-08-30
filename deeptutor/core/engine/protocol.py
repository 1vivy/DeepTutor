"""The seam between the chat pipeline and whatever drives one turn's loop.

``AgenticChatPipeline`` (``deeptutor/agents/chat/agentic_pipeline.py``) does the
work no engine should have to repeat: assembling the turn's context (system
prompt, KB seed, workspace note, capability blocks), resolving which tools are
enabled, and owning the turn's ``UsageTracker`` / i18n / prompt config. A
:class:`TurnEngine` is the thing that actually *drives* the turn from there —
today that is DeepTutor's own tool-calling agent loop
(:class:`~deeptutor.core.engine.deeptutor_engine.DeepTutorEngine`, wrapping
:class:`~deeptutor.agents.chat.agent_loop.AgentLoop`); an external harness the
user runs locally (Codex CLI today —
:class:`~deeptutor.core.engine.cli_engine.CliEngine`) is a second
implementation of the same seam.

An engine is constructed with the pipeline (as a read-only facade — i18n,
tool_lookup, usage, the capability hooks), the turn's ``UnifiedContext``, and
its ``StreamBus``, and its ``run()`` is awaited exactly once. What it does
before returning is entirely its own: stream ``StreamEvent``s onto ``stream``,
and (if it wants the CAPABILITY_COMPLETE event's ``agent_output`` populated)
set ``context.metadata[AGENT_OUTPUT]`` before returning — see
``deeptutor.capabilities.protocol`` for that contract, which every capability
already writes to.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from deeptutor.agents.chat.agentic_pipeline import AgenticChatPipeline
    from deeptutor.core.context import UnifiedContext
    from deeptutor.core.stream_bus import StreamBus

#: ``context.config_overrides`` key carrying the user's requested engine for
#: this turn, e.g. ``{"kind": "codex_cli"}`` — the same per-turn escape hatch
#: the composer already uses for ``subagent_consult_budget`` and friends (see
#: ``deeptutor.capabilities.subagent.capability._resolve_budget``). Absent,
#: empty, or ``{"kind": "deeptutor"}`` all mean "run the built-in harness" —
#: see ``registry.resolve_engine``.
ENGINE_SELECTION_KEY = "engine_selection"

#: The always-available, default engine kind.
ENGINE_DEEPTUTOR = "deeptutor"


class TurnEngine(Protocol):
    """Drives one turn's loop. Constructed fresh per turn; ``run`` once."""

    async def run(self) -> None:
        """Drive the turn to completion, streaming events onto ``stream``."""
        ...


class TurnEngineFactory(Protocol):
    """Builds a :class:`TurnEngine` for one turn."""

    def __call__(
        self,
        *,
        pipeline: "AgenticChatPipeline",
        context: "UnifiedContext",
        stream: "StreamBus",
    ) -> TurnEngine: ...


__all__ = [
    "ENGINE_SELECTION_KEY",
    "ENGINE_DEEPTUTOR",
    "TurnEngine",
    "TurnEngineFactory",
]
