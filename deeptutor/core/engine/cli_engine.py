"""A local agent CLI, driving the turn instead of DeepTutor's own loop.

This is the second :class:`~deeptutor.core.engine.protocol.TurnEngine`
implementation, proving the abstraction against two real external harnesses —
Codex CLI and Claude Code CLI — run non-interactively on the user's own
machine via the same :class:`~deeptutor.services.subagent.base.SubagentBackend`
subclasses that already drive them for ``consult_subagent`` (process spawn,
native event parsing, session resume — none of that is duplicated here).

What's new is the direction of the tool bridge. ``consult_subagent`` is
DeepTutor calling *out* to a subagent from inside its own loop; here the CLI
calls *back into* DeepTutor for its context and tools, over the turn-scoped
MCP server in ``mcp_bridge.py`` — the CLI keeps its own system prompt, its own
loop, its own local config (models, skills, whatever MCP servers the user
already added there); DeepTutor only adds one more MCP server to that run,
scoped to this one turn.

Two things this engine owns that a tool-call-style integration (like
``consult_subagent``) does not:

* **The trace renders inline**, in the same ``CallTracePanel`` a native
  ``AgentLoop`` turn uses — reasoning as an ``agent_loop_round`` (exactly
  DeepTutor's own reasoning row), the CLI's tool/command activity as one
  ``tool_planning`` row. Deliberately NOT the ``subagent_event`` /
  side-viewer-tab mechanism ``consult_subagent`` uses — that mechanism exists
  for a subagent *consulted* mid-turn as one tool call among others; this
  engine drives the *entire* turn, so its work is the turn's own trace, shown
  where a user reading the conversation already looks — not a side panel.
* **The CLI's own session persists across DeepTutor turns** (see
  ``services/subagent/sessions.py``): the same registry ``consult_subagent``
  uses to resume a connection's session is keyed here by
  ``(chat session, "engine:<backend_kind>")``, so the second message in a
  DeepTutor chat resumes the *same* Codex/Claude Code session — full context,
  same working directory — instead of starting cold every turn.
"""

from __future__ import annotations

import inspect
import logging
from typing import TYPE_CHECKING, Any

from deeptutor.capabilities.protocol import AGENT_OUTPUT
from deeptutor.core.engine.mcp_bridge import TurnToolServer
from deeptutor.core.trace import build_trace_metadata, merge_trace_metadata, new_call_id
from deeptutor.services.subagent.types import (
    EVENT_ERROR,
    EVENT_LOG,
    EVENT_REASONING,
    EVENT_TEXT,
    EVENT_TOOL,
    EVENT_TOOL_RESULT,
    SubagentEvent,
)

if TYPE_CHECKING:
    from deeptutor.agents.chat.agentic_pipeline import AgenticChatPipeline
    from deeptutor.core.context import UnifiedContext
    from deeptutor.core.stream_bus import StreamBus

logger = logging.getLogger(__name__)

#: The tool surface bridged to the CLI for this first cut — the three that
#: most concretely ARE "DeepTutor's context": the user's knowledge bases, the
#: files inside them, and the web. Widening this is adding names here; nothing
#: else needs to change (``TurnToolServer`` bridges any registered tool).
#: Deliberately excluded: anything whose contract assumes a call from *inside*
#: DeepTutor's own loop — ``ask_user`` (pause/resume has no channel here),
#: ``load_tools`` (the deferred-schema dance), ``consult_subagent`` (would
#: recurse into this very mechanism).
CLI_ENGINE_ALLOWED_TOOLS: tuple[str, ...] = ("rag", "kb_files", "web_search")

#: Backend kinds this engine knows how to drive. Both implement the
#: ``mcp_server_url`` parameter (see ``services/subagent/codex.py`` and
#: ``claude_code.py``); a backend that doesn't is still handed every other
#: kwarg exactly as ``consult_subagent`` would — see the ``inspect.signature``
#: check in ``run()`` below.
CLI_ENGINE_BACKEND_KINDS: tuple[str, ...] = ("codex", "claude_code")


class CliEngine:
    """Drives the turn by consulting a local agent CLI instead of ``AgentLoop``."""

    def __init__(
        self,
        *,
        pipeline: "AgenticChatPipeline",
        context: "UnifiedContext",
        stream: "StreamBus",
        backend_kind: str,
    ) -> None:
        self._pipeline = pipeline
        self._context = context
        self._stream = stream
        self._backend_kind = backend_kind

    async def run(self) -> None:
        from deeptutor.services.subagent.config import load_subagent_settings
        from deeptutor.services.subagent.registry import get_backend
        from deeptutor.services.subagent.sessions import (
            get_session,
            remember_session,
            session_key,
        )

        pipeline = self._pipeline
        context = self._context
        stream = self._stream

        backend = get_backend(self._backend_kind)
        if backend is None:
            await self._fail(f"Engine '{self._backend_kind}' is not available.")
            return

        detection = await backend.detect()
        if not detection.available:
            await self._fail(
                f"{backend.display_name} is not installed or not reachable on this "
                f"machine ({detection.detail or 'not found on PATH'}). Install it, or "
                "switch this session back to the DeepTutor engine in Settings."
            )
            return

        config = load_subagent_settings().backend(self._backend_kind)
        cwd = self._session_cwd()
        # Resume the SAME backend session this DeepTutor chat session used
        # last turn (if any) — same registry consult_subagent's tool and the
        # sidebar's "message the agent directly" box already share, so all
        # three surfaces agree on one live session per (chat, engine).
        registry_key = session_key(context.session_id, f"engine:{self._backend_kind}")
        prior_session_id = get_session(registry_key)

        trace = _CliTrace(stream=stream, backend_kind=self._backend_kind)
        async with TurnToolServer(
            pipeline=pipeline,
            context=context,
            stream=stream,
            tool_names=CLI_ENGINE_ALLOWED_TOOLS,
        ) as tool_server:
            consult_kwargs: dict[str, Any] = {}
            if "mcp_server_url" in inspect.signature(backend.consult).parameters:
                consult_kwargs["mcp_server_url"] = tool_server.url
            else:
                logger.warning(
                    "Engine backend '%s' has no mcp_server_url support; %s will run "
                    "without DeepTutor's tools/context this turn.",
                    self._backend_kind,
                    backend.display_name,
                )

            async def on_event(event: SubagentEvent) -> None:
                await trace.handle(event)

            result = await backend.consult(
                context.user_message,
                on_event=on_event,
                cwd=cwd,
                session_id=prior_session_id,
                config=config,
                **consult_kwargs,
            )
        await trace.finalize()

        if result.session_id:
            remember_session(
                registry_key, result.session_id, kind=self._backend_kind, cwd=cwd or ""
            )

        final_text = (result.final_text or trace.final_text or "").strip()
        if not final_text:
            final_text = (
                f"[{backend.display_name} produced no answer: {result.error or 'no final message'}]"
            )
        # The CLI's own streamed text already rendered the answer live
        # (``_CliTrace``); this is the authoritative copy for whatever
        # persists the turn (matches every capability's ``AGENT_OUTPUT``
        # contract — see ``deeptutor.capabilities.protocol``).
        context.metadata[AGENT_OUTPUT] = final_text

    async def _fail(self, message: str) -> None:
        await self._stream.error(
            message,
            source="engine",
            metadata={"turn_terminal": True, "status": "failed"},
        )
        self._context.metadata[AGENT_OUTPUT] = message

    def _session_cwd(self) -> str | None:
        """One working directory per (DeepTutor chat session, backend) — stable
        across every turn of that session, not per-turn: session resume only
        means something if the files the CLI was looking at are still there.
        """
        from deeptutor.services.path_service import get_path_service

        raw = str(self._context.session_id or "").strip()
        cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in raw)
        workspace_key = cleaned.strip("_") or "direct"
        task_dir = get_path_service().get_task_workspace("chat", workspace_key)
        engine_dir = task_dir / "engine" / self._backend_kind
        engine_dir.mkdir(parents=True, exist_ok=True)
        return str(engine_dir)


class _CliTrace:
    """Turns the CLI's native run into the turn's own inline trace + answer.

    Two rows, reusing DeepTutor's own trace vocabulary so nothing new is
    needed on the frontend:

    * **Reasoning** streams live as an ``agent_loop_round`` — the exact
      ``call_kind`` ``AgentLoop`` itself uses for a round's reasoning (see
      ``agent_loop.py::_call_llm``) — so it renders as the same always-open,
      markdown "thinking" block a native DeepTutor turn would show. One
      shared call id for the whole run (a CLI run doesn't have DeepTutor's
      notion of discrete rounds).
    * **Tool/command activity** (shell commands, file edits, its own internal
      tool calls, log lines) accumulates into ONE ``tool_planning`` row —
      opened the moment the first such event arrives (so the row appears and
      pulses while the CLI works), filled in once with the full accumulated
      log when the run ends via :meth:`finalize`. Emitting a fresh
      ``tool_result`` per raw event would instead stack one detail block per
      event in the frontend's generic tool-row renderer (it renders every
      ``tool_result`` event in the group, not just the latest) — so this
      batches instead of streaming that row live.

    ``EVENT_TEXT`` is separately split into incremental deltas and streamed
    as the turn's actual chat-bubble content via ``stream.content`` — the
    CLI's answer *is* the user-facing answer here (unlike ``consult_subagent``,
    where a wrapping DeepTutor model narrates its own answer from the tool
    result). The delta math exists because each ``EVENT_TEXT``/
    ``EVENT_REASONING`` frame carries the item's whole text so far, not a
    delta (see ``CodexBackend._handle_event``); replaying it verbatim through
    ``stream.content()`` would re-render the growing answer from scratch on
    every frame. Tracking the longest common prefix per key recovers the
    delta; a frame that doesn't extend the previous one (should not happen,
    but cheap to guard) falls back to emitting the whole new frame rather
    than silently dropping it.
    """

    def __init__(self, *, stream: "StreamBus", backend_kind: str) -> None:
        self._stream = stream
        self._backend_kind = backend_kind
        self._seen: dict[str, str] = {}
        self.final_text = ""
        self._reasoning_meta: dict[str, Any] | None = None
        self._tool_meta: dict[str, Any] | None = None
        self._tool_log: list[str] = []

    async def handle(self, event: SubagentEvent) -> None:
        if event.kind == EVENT_TEXT:
            delta = self._advance(event.meta.get("merge_id") or "answer", event.text)
            if delta:
                self.final_text = event.text
                await self._stream.content(delta, source="engine", stage="responding")
        elif event.kind == EVENT_REASONING:
            await self._emit_reasoning(event)
        elif event.kind in (EVENT_TOOL, EVENT_TOOL_RESULT, EVENT_LOG):
            self._buffer_tool_activity(event)
            await self._open_tool_row_if_needed()
        elif event.kind == EVENT_ERROR:
            self._buffer_tool_activity(event)
            await self._open_tool_row_if_needed()
            if event.text:
                await self._stream.error(event.text, source="engine", stage="responding")

    async def finalize(self) -> None:
        """Fill in the tool row's detail body once the CLI run has ended."""
        if self._tool_meta is None or not self._tool_log:
            return
        await self._stream.tool_result(
            tool_name=self._backend_kind,
            result="\n".join(self._tool_log),
            source="engine",
            stage="responding",
            metadata=merge_trace_metadata(self._tool_meta, {"trace_kind": "tool_result"}),
        )

    async def _emit_reasoning(self, event: SubagentEvent) -> None:
        delta = self._advance(event.meta.get("merge_id") or "reasoning", event.text)
        if not delta:
            return
        if self._reasoning_meta is None:
            call_id = new_call_id("cli-engine-reasoning")
            self._reasoning_meta = build_trace_metadata(
                call_id=call_id,
                phase="responding",
                label=self._backend_kind,
                call_kind="agent_loop_round",
                trace_id=call_id,
                trace_role="explore",
                trace_group="stage",
            )
        await self._stream.thinking(
            delta,
            source="engine",
            stage="responding",
            metadata=merge_trace_metadata(self._reasoning_meta, {"trace_kind": "llm_chunk"}),
        )

    def _buffer_tool_activity(self, event: SubagentEvent) -> None:
        if event.text:
            self._tool_log.append(event.text)

    async def _open_tool_row_if_needed(self) -> None:
        if self._tool_meta is not None or not self._tool_log:
            return
        call_id = new_call_id("cli-engine-tool")
        self._tool_meta = build_trace_metadata(
            call_id=call_id,
            phase="responding",
            label=self._backend_kind,
            call_kind="tool_planning",
            trace_id=call_id,
            trace_role="tool",
            trace_group="tool_call",
        )
        await self._stream.tool_call(
            tool_name=self._backend_kind,
            args={},
            source="engine",
            stage="responding",
            metadata=merge_trace_metadata(self._tool_meta, {"trace_kind": "tool_call"}),
        )

    def _advance(self, key: str, text: str) -> str:
        previous = self._seen.get(key, "")
        self._seen[key] = text
        if text.startswith(previous):
            return text[len(previous) :]
        return text


__all__ = ["CliEngine", "CLI_ENGINE_ALLOWED_TOOLS", "CLI_ENGINE_BACKEND_KINDS"]
