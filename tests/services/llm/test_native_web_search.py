"""Tests for native server-side web_search support (#846).

Covers the three seams a native web search crosses:

* ``convert_tools`` — DeepTutor's ``web_search`` function tool declared as the
  provider's native ``{"type": "web_search"}`` tool.
* history replay — a server-executed call round-trips as a ``web_search_call``
  output item (not a function_call), with no function_call_output.
* parsing — ``web_search_call`` output items and ``url_citation`` annotations
  synthesize a marked ``web_search`` ToolCallRequest instead of a dispatchable
  local function call.
"""

from __future__ import annotations

import json

import pytest

from deeptutor.core.agentic.tool_dispatch import dispatch_tool_calls
from deeptutor.core.context import UnifiedContext
from deeptutor.core.stream_bus import StreamBus
from deeptutor.services.llm.provider_core.openai_responses import (
    consume_sse,
    convert_messages,
    convert_tools,
)
from deeptutor.services.llm.provider_core.openai_responses.parsing import (
    parse_response_output,
)


class _SSEFixture:
    def __init__(self, events: list[dict]) -> None:
        self._events = events

    async def aiter_lines(self):
        for event in self._events:
            yield f"data: {json.dumps(event)}"
            yield ""


class _ExecutedWebSearchTool:
    """A local web_search stand-in that fails the test if executed."""

    def get_definition(self):
        class _Def:
            name = "web_search"

        return _Def()

    async def execute(self, **kwargs):
        raise AssertionError("server-executed web_search must not run locally")


class _Registry:
    def __init__(self, tool):
        self._tool = tool

    def get(self, name):
        if name == "web_search":
            return self._tool
        raise KeyError(name)

    async def execute(self, name, **kwargs):
        tool = self.get(name)
        return await tool.execute(**kwargs)


class _Stream:
    def __init__(self):
        self.events: list[dict] = []

    def __getattr__(self, name):
        async def _emit(*args, **kwargs):
            self.events.append({"event": name, **kwargs})

        return _emit


# ---------------------------------------------------------------------------
# convert_tools: native mapping
# ---------------------------------------------------------------------------


class TestConvertToolsNativeWebSearch:
    def test_web_search_maps_to_native_tool_when_enabled(self) -> None:
        tools = [
            {"type": "function", "function": {"name": "web_search", "parameters": {}}},
            {"type": "function", "function": {"name": "rag", "parameters": {}}},
        ]
        converted = convert_tools(tools, native_web_search=True)
        assert {"type": "web_search"} in converted
        # Other tools keep their function schema.
        assert {"type": "function", "name": "rag", "description": "", "parameters": {}} in converted
        assert len(converted) == 2

    def test_web_search_stays_a_function_by_default(self) -> None:
        tools = [{"type": "function", "function": {"name": "web_search", "parameters": {}}}]
        converted = convert_tools(tools)
        assert converted == [
            {"type": "function", "name": "web_search", "description": "", "parameters": {}}
        ]


# ---------------------------------------------------------------------------
# convert_messages: server-executed history replay
# ---------------------------------------------------------------------------


class TestConvertMessagesServerExecutedReplay:
    def test_server_executed_call_replays_as_web_search_item(self) -> None:
        marker = {"server_executed": True, "citations": [{"url": "https://x", "title": "X"}]}
        messages = [
            {"role": "user", "content": "hi"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "ws_1",
                        "type": "function",
                        "function": {"name": "web_search", "arguments": "fft"},
                        "provider_specific_fields": marker,
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "ws_1", "name": "web_search", "content": "{}"},
        ]
        _, items = convert_messages(messages)
        types = [item.get("type") for item in items]
        assert "web_search_call" in types
        assert "function_call" not in types
        # The stub role=tool message must not produce a function_call_output.
        assert "function_call_output" not in types
        ws_item = next(item for item in items if item.get("type") == "web_search_call")
        assert ws_item["id"] == "ws_1"
        assert ws_item["status"] == "completed"

    def test_regular_calls_keep_function_pairing(self) -> None:
        messages = [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "rag", "arguments": "{}"},
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "call_1", "name": "rag", "content": "ok"},
        ]
        _, items = convert_messages(messages)
        assert [item["type"] for item in items] == ["function_call", "function_call_output"]


# ---------------------------------------------------------------------------
# parsing: web_search_call items + url_citation annotations
# ---------------------------------------------------------------------------


class TestParseServerExecutedWebSearch:
    def test_parse_response_output_synthesizes_marked_call(self) -> None:
        response = {
            "output": [
                {
                    "type": "web_search_call",
                    "id": "ws_abc",
                    "status": "completed",
                    "action": {"type": "search", "query": "cooley tukey fft"},
                },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "FFT is O(N log N).",
                            "annotations": [
                                {
                                    "type": "url_citation",
                                    "url": "https://example.com/paper",
                                    "title": "Cooley-Tukey",
                                }
                            ],
                        }
                    ],
                },
            ],
            "status": "completed",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = parse_response_output(response)
        assert result.content == "FFT is O(N log N)."
        assert len(result.tool_calls) == 1
        call = result.tool_calls[0]
        assert call.name == "web_search"
        assert call.arguments == {"query": "cooley tukey fft"}
        fields = call.provider_specific_fields or {}
        assert fields["server_executed"] is True
        assert fields["citations"] == [
            {"url": "https://example.com/paper", "title": "Cooley-Tukey"}
        ]

    @pytest.mark.asyncio
    async def test_sse_stream_collects_item_and_annotations(self) -> None:
        events = [
            {
                "type": "response.output_item.added",
                "item": {"type": "web_search_call", "id": "ws_1", "status": "in_progress"},
            },
            {
                "type": "response.output_text.annotation.added",
                "annotation": {"type": "url_citation", "url": "https://a", "title": "A"},
            },
            {
                "type": "response.output_text.annotation.added",
                "annotation": {"type": "url_citation", "url": "https://b", "title": "B"},
            },
            {"type": "response.output_text.delta", "delta": "hello"},
            {
                "type": "response.output_item.done",
                "item": {
                    "type": "web_search_call",
                    "id": "ws_1",
                    "status": "completed",
                    "action": {"query": "test"},
                },
            },
        ]
        content, tool_calls, _ = await consume_sse(_SSEFixture(events))
        assert content == "hello"
        assert len(tool_calls) == 1
        fields = tool_calls[0].provider_specific_fields or {}
        assert fields["server_executed"] is True
        assert fields["citations"] == [
            {"url": "https://a", "title": "A"},
            {"url": "https://b", "title": "B"},
        ]

    @pytest.mark.asyncio
    async def test_sse_deduplicates_repeated_done_items(self) -> None:
        events = [
            {
                "type": "response.output_item.done",
                "item": {"type": "web_search_call", "id": "ws_1", "status": "completed"},
            },
            {
                "type": "response.output_item.done",
                "item": {"type": "web_search_call", "id": "ws_1", "status": "completed"},
            },
        ]
        _, tool_calls, _ = await consume_sse(_SSEFixture(events))
        assert len(tool_calls) == 1

    @pytest.mark.asyncio
    async def test_sse_annotations_after_item_done_are_kept(self) -> None:
        # Realistic ordering: the search item completes first, then the answer
        # text streams with its citations. The tail annotations must merge
        # into the search's call, not be dropped.
        events = [
            {
                "type": "response.output_item.done",
                "item": {
                    "type": "web_search_call",
                    "id": "ws_1",
                    "status": "completed",
                    "action": {"query": "fft"},
                },
            },
            {"type": "response.output_text.delta", "delta": "FFT is O(N log N)."},
            {
                "type": "response.output_text.annotation.added",
                "annotation": {"type": "url_citation", "url": "https://a", "title": "A"},
            },
        ]
        _, tool_calls, _ = await consume_sse(_SSEFixture(events))
        assert len(tool_calls) == 1
        call = tool_calls[0]
        assert call.arguments == {"query": "fft"}
        assert call.provider_specific_fields["citations"] == [{"url": "https://a", "title": "A"}]


# ---------------------------------------------------------------------------
# dispatch: server-executed calls never run the local tool
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_short_circuits_server_executed_call() -> None:
    tool_calls = [
        {
            "id": "ws_1",
            "name": "web_search",
            "arguments": json.dumps({"query": "fft"}),
            "provider_specific_fields": {
                "server_executed": True,
                "query": "fft",
                "citations": [{"url": "https://example.com", "title": "Example"}],
            },
        }
    ]
    stream = _Stream()
    context = UnifiedContext(user_message="q", session_id="s", attachments=[])
    outcome = await dispatch_tool_calls(
        tool_calls=tool_calls,
        context=context,
        stream=stream,
        source="chat",
        stage="responding",
        iteration_index=0,
        registry=_Registry(_ExecutedWebSearchTool()),
    )

    # The local tool never ran (it raises AssertionError on execute).
    assert len(outcome.tool_messages) == 1
    message = outcome.tool_messages[0]
    assert message["role"] == "tool"
    assert message["tool_call_id"] == "ws_1"
    payload = json.loads(message["content"])
    assert payload["server_executed"] is True
    assert payload["citations"] == [{"url": "https://example.com", "title": "Example"}]
    assert outcome.sources == [{"type": "web", "url": "https://example.com", "title": "Example"}]
