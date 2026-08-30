"""A turn-scoped MCP server exposing DeepTutor's own tools to an external engine.

This is how :class:`~deeptutor.core.engine.cli_engine.CliEngine` gives a local
CLI (Codex today) the same context and tools a plain chat turn has, without
DeepTutor and the loop that drives a turn being coupled to each other: the CLI
is handed a URL, and every ``rag`` / ``web_search`` / ... call it makes comes
back through the exact same server-side path a native tool call in
``AgentLoop`` would — ``AgenticChatPipeline._augment_tool_kwargs`` (the
server-owned parameter binding: KB scoping, workspace dirs, sandbox mounts —
see its docstring) followed by ``core.agentic.tool_dispatch.execute_tool_call``
(the same dispatcher a normal round uses, so the turn's sidebar trace shows
these calls exactly like it would any other tool call).

One instance is started per turn and torn down when the turn ends — nothing
about it outlives the ``async with`` block. It binds ``127.0.0.1`` only: a
local CLI on the same machine is the only intended caller, matching that
CLI's own trust model (see ``services/subagent/config.py``: a connected local
CLI already runs autonomously on the user's own machine).

Only a small, explicit allowlist of tools is exposed for now (see
``cli_engine.py``) — anything whose contract assumes it is called from
*inside* DeepTutor's own loop (``ask_user``'s pause/resume, ``load_tools``'s
deferred-schema dance, ``consult_subagent`` recursing into this very
mechanism) is deliberately left off until there is a reason to bridge it too.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
import contextlib
import logging
import socket
from typing import TYPE_CHECKING, Any

from deeptutor.core.trace import build_trace_metadata, new_call_id

if TYPE_CHECKING:
    from deeptutor.agents.chat.agentic_pipeline import AgenticChatPipeline
    from deeptutor.core.context import UnifiedContext
    from deeptutor.core.stream_bus import StreamBus

logger = logging.getLogger(__name__)

#: How long to wait for uvicorn to report "started" before giving up.
_STARTUP_TIMEOUT_S = 5.0


class TurnToolServer:
    """Async context manager: on entry, serves ``tool_names`` over MCP at ``url``."""

    def __init__(
        self,
        *,
        pipeline: "AgenticChatPipeline",
        context: "UnifiedContext",
        stream: "StreamBus",
        tool_names: Sequence[str],
    ) -> None:
        self._pipeline = pipeline
        self._context = context
        self._stream = stream
        self._tool_names = [n for n in tool_names if pipeline.tool_lookup.get(n) is not None]
        self._port: int | None = None
        self._uvicorn_server: Any = None
        self._serve_task: asyncio.Task[None] | None = None

    @property
    def url(self) -> str:
        if self._port is None:
            raise RuntimeError("TurnToolServer not started")
        return f"http://127.0.0.1:{self._port}/mcp"

    @property
    def tool_names(self) -> list[str]:
        return list(self._tool_names)

    async def __aenter__(self) -> "TurnToolServer":
        await self._start()
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self._stop()

    # -- lifecycle ----------------------------------------------------------

    async def _start(self) -> None:
        from mcp.server.fastmcp import FastMCP
        import mcp.types as types
        import uvicorn

        mcp_server = FastMCP(
            name="deeptutor",
            # No client-visible session state of our own — the tool calls are
            # bound to this turn via closure, not via an MCP session.
            stateless_http=True,
            json_response=True,
        )
        low_level = mcp_server._mcp_server  # noqa: SLF001 — see module docstring

        tool_defs = {name: self._pipeline.tool_lookup.get(name) for name in self._tool_names}

        @low_level.list_tools()
        async def _list_tools() -> list[types.Tool]:
            out: list[types.Tool] = []
            for name, tool in tool_defs.items():
                if tool is None:
                    continue
                schema = tool.get_definition().to_openai_schema()["function"]
                out.append(
                    types.Tool(
                        name=name,
                        description=schema.get("description") or "",
                        inputSchema=schema.get("parameters")
                        or {"type": "object", "properties": {}},
                    )
                )
            return out

        @low_level.call_tool()
        async def _call_tool(name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
            if name not in tool_defs:
                return [types.TextContent(type="text", text=f"Unknown tool: {name}")]
            text = await self._run_tool(name, arguments or {})
            return [types.TextContent(type="text", text=text)]

        app = mcp_server.streamable_http_app()

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 0))
        sock.listen(128)
        self._port = sock.getsockname()[1]

        config = uvicorn.Config(app, log_level="warning", lifespan="on")
        self._uvicorn_server = uvicorn.Server(config)
        self._serve_task = asyncio.create_task(self._uvicorn_server.serve(sockets=[sock]))

        waited = 0.0
        while not self._uvicorn_server.started:
            if self._serve_task.done():
                # Surface a startup failure (e.g. the port vanished) now
                # rather than as an opaque connection-refused from the CLI.
                self._serve_task.result()
                raise RuntimeError("turn tool server exited before starting")
            await asyncio.sleep(0.02)
            waited += 0.02
            if waited > _STARTUP_TIMEOUT_S:
                raise TimeoutError("turn tool server did not start in time")

    async def _stop(self) -> None:
        if self._uvicorn_server is not None:
            self._uvicorn_server.should_exit = True
        if self._serve_task is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._serve_task, timeout=5.0)

    # -- tool execution -------------------------------------------------------

    async def _run_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Run one MCP-invoked tool call through the pipeline's own dispatch path.

        Mirrors what ``core.agentic.tool_dispatch.dispatch_tool_calls`` does for
        one call in a native round: server-side kwarg augmentation, then
        ``execute_tool_call`` with a fresh trace sub-trace so the turn's sidebar
        shows this call like any other.
        """
        pipeline = self._pipeline
        context = self._context
        args = pipeline._augment_tool_kwargs(name, dict(arguments), context)  # noqa: SLF001

        call_id = new_call_id("cli-engine-tool")
        base_meta = build_trace_metadata(
            call_id=call_id,
            phase="responding",
            label=pipeline._t("labels.tool_call", default="Tool call"),  # noqa: SLF001
            call_kind="tool_planning",
            trace_id=call_id,
            trace_role="tool",
            trace_group="tool_call",
        )
        retrieve_meta = (
            pipeline._retrieve_trace_metadata(  # noqa: SLF001
                base_meta, context=context, tool_name=name, tool_args=args
            )
            or base_meta
        )
        try:
            result = await pipeline._execute_tool_call(  # noqa: SLF001
                name, args, stream=self._stream, retrieve_meta=retrieve_meta
            )
        except Exception as exc:  # defensive — the CLI must get an answer, not a hang
            logger.warning("cli engine tool '%s' failed", name, exc_info=True)
            return f"Error executing {name}: {exc}"
        return str(result.get("result_text") or "")


__all__ = ["TurnToolServer"]
