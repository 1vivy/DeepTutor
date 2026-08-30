"""The default :class:`TurnEngine`: DeepTutor's own tool-calling agent loop.

This is a behavior-preserving extraction. Every line below used to be the body
of ``AgenticChatPipeline.run()``; moving it here only gives it a name so
``engine/registry.py`` can choose between it and an alternative engine (see
``cli_engine.py``). Nothing about how a plain chat/solve/mastery/... turn runs
changes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from deeptutor.agents.chat.agent_loop import AgentLoop
from deeptutor.core.context import UnifiedContext
from deeptutor.core.stream_bus import StreamBus

if TYPE_CHECKING:
    from deeptutor.agents.chat.agentic_pipeline import AgenticChatPipeline


class DeepTutorEngine:
    """Wraps :class:`~deeptutor.agents.chat.agent_loop.AgentLoop`."""

    def __init__(
        self,
        *,
        pipeline: "AgenticChatPipeline",
        context: UnifiedContext,
        stream: StreamBus,
    ) -> None:
        self._pipeline = pipeline
        self._context = context
        self._stream = stream

    async def run(self) -> None:
        pipeline = self._pipeline
        context = self._context
        stream = self._stream

        await pipeline._prepare_deferred_tools(context)
        await pipeline._prepare_kb_manifests(context)
        pipeline._exec_enabled = await pipeline._exec_allowed(context)
        enabled_tools = pipeline._compose_enabled_tools(context)
        use_native_tools = bool(enabled_tools) and pipeline._can_use_native_tool_calling()
        tool_schemas = (
            pipeline._build_llm_tool_schemas(enabled_tools, context) if use_native_tools else None
        )
        if tool_schemas is not None and pipeline._tool_view is not None:
            pipeline._tool_view.attach(tool_schemas)

        loop = AgentLoop(
            pipeline=pipeline,
            context=context,
            stream=stream,
            client=pipeline._build_openai_client(),
            enabled_tools=enabled_tools if use_native_tools else [],
            tool_schemas=tool_schemas,
        )
        await loop.run()


__all__ = ["DeepTutorEngine"]
