"""Delegation to another capability, as seen from the parent turn.

The tests that matter are the containment ones: a child capability must be
visible without being able to speak as the parent, end the parent's turn, block
it on a question, or delegate again.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from deeptutor.core.context import UnifiedContext
from deeptutor.core.delegated_stream import DelegatedStream
from deeptutor.core.stream import StreamEventType
from deeptutor.core.stream_bus import StreamBus
from deeptutor.tools.subagent_capability import (
    DELEGABLE_CAPABILITIES,
    SUBAGENT_CAPABILITY_TOOL_NAMES,
    RunSubagentTool,
)


class _FakeCapability:
    """Stands in for a real capability, doing each thing one might do."""

    def __init__(
        self,
        *,
        content: str = "",
        result: dict[str, Any] | None = None,
        tools: tuple[str, ...] = (),
        ask: str = "",
        raise_exc: Exception | None = None,
        emit_done: bool = True,
    ) -> None:
        self.content = content
        self.result = result
        self.tools = tools
        self.ask = ask
        self.raise_exc = raise_exc
        self.emit_done = emit_done
        self.seen_context: UnifiedContext | None = None

    async def run(self, context: UnifiedContext, stream: StreamBus) -> None:
        self.seen_context = context
        async with stream.stage("working", source="fake"):
            for tool in self.tools:
                await stream.tool_call(tool, {}, source="fake")
            if self.ask:
                await stream.wait_for_input(self.ask, source="fake")
            if self.content:
                await stream.content(self.content, source="fake")
            if self.raise_exc is not None:
                raise self.raise_exc
            if self.result is not None:
                await stream.result(self.result, source="fake")
        if self.emit_done:
            await stream.emit_done() if hasattr(stream, "emit_done") else None


def _parent_context(**overrides: Any) -> UnifiedContext:
    base = {
        "session_id": "sess-1",
        "user_message": "the parent's question",
        "conversation_history": [{"role": "user", "content": "earlier"}],
        "language": "zh",
        "knowledge_bases": ["kb-a"],
        "memory_context": "parent memory",
        "persona_context": "parent persona",
        "metadata": {"turn_id": "turn-1", "mastery_mode": True},
    }
    base.update(overrides)
    return UnifiedContext(**base)


def _run_tool(fake: _FakeCapability, monkeypatch: pytest.MonkeyPatch, **kwargs: Any):
    """Invoke the tool with ``fake`` standing in for the registry entry."""

    class _Registry:
        def get(self, name: str) -> Any:
            return fake

    monkeypatch.setattr(
        "deeptutor.runtime.registry.capability_registry.get_capability_registry",
        lambda: _Registry(),
    )
    parent_stream = StreamBus()
    payload = {
        "capability": "deep_research",
        "goal": "find the papers",
        "_parent_context": _parent_context(),
        "_stream": parent_stream,
    }
    payload.update(kwargs)
    result = asyncio.run(RunSubagentTool().execute(**payload))
    return result, parent_stream


# ── Containment ──────────────────────────────────────────────────────────


def test_child_content_never_reaches_the_parent_as_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The child's prose must not splice itself into the parent's answer.

    The parent turn builds its assistant message from CONTENT events on this
    bus. A child emitting CONTENT there would appear as the parent speaking.
    """
    cap = _FakeCapability(content="I am the subagent's answer.")
    result, parent_stream = _run_tool(cap, monkeypatch)

    kinds = [event.type for event in parent_stream._history]
    assert StreamEventType.CONTENT not in kinds
    # Still visible — forwarded as reasoning.
    thinking = [e.content for e in parent_stream._history if e.type == StreamEventType.THINKING]
    assert "I am the subagent's answer." in "".join(thinking)
    # And delivered to the model as the tool's output.
    assert "I am the subagent's answer." in result.content
    assert result.success


def test_child_cannot_end_the_parent_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _FakeCapability(result={"response": "done"})
    _result, parent_stream = _run_tool(cap, monkeypatch)

    kinds = [event.type for event in parent_stream._history]
    assert StreamEventType.DONE not in kinds
    assert StreamEventType.RESULT not in kinds


def test_child_question_does_not_block_the_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    """``wait_for_input`` on a real bus waits forever; here it must return."""
    cap = _FakeCapability(ask="Which chapter?", content="proceeded anyway")
    result, _ = _run_tool(cap, monkeypatch)

    assert result.success
    assert "Which chapter?" in result.content


def test_child_that_only_asked_reports_the_question(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cap = _FakeCapability(ask="Which chapter?")
    result, _ = _run_tool(cap, monkeypatch)

    assert not result.success
    assert "Which chapter?" in result.content
    assert "cannot" in result.content


def test_subagent_cannot_delegate_further(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _FakeCapability(content="nested")
    result, _ = _run_tool(
        cap,
        monkeypatch,
        _parent_context=_parent_context(metadata={"_subagent_depth": 1}),
    )

    assert not result.success
    assert "already running as a subagent" in result.content


# ── Visibility ───────────────────────────────────────────────────────────


def test_child_tool_calls_reach_the_activity_panel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Forwarded tool_call events are what the Activity panel tallies."""
    cap = _FakeCapability(tools=("web_search", "paper_search"), content="ok")
    _result, parent_stream = _run_tool(cap, monkeypatch)

    forwarded = [e for e in parent_stream._history if e.type == StreamEventType.TOOL_CALL]
    assert [e.content for e in forwarded] == ["web_search", "paper_search"]
    assert all(e.metadata.get("subagent") == "deep_research" for e in forwarded)


def test_stage_boundaries_are_forwarded(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _FakeCapability(content="ok")
    _result, parent_stream = _run_tool(cap, monkeypatch)

    kinds = [e.type for e in parent_stream._history]
    assert StreamEventType.STAGE_START in kinds
    assert StreamEventType.STAGE_END in kinds


# ── Child context derivation ─────────────────────────────────────────────


def test_child_gets_the_goal_and_not_the_parent_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cap = _FakeCapability(content="ok")
    _run_tool(cap, monkeypatch, goal="find the papers on Agentic RAG")

    child = cap.seen_context
    assert child is not None
    assert child.user_message == "find the papers on Agentic RAG"
    assert child.conversation_history == []
    # Scope-defining fields survive; the parent's voice does not.
    assert child.session_id == "sess-1"
    assert child.language == "zh"
    assert child.knowledge_bases == ["kb-a"]
    assert child.memory_context == ""
    assert child.persona_context == ""
    # Depth stamped, and the parent's mastery framing dropped.
    assert child.metadata["_subagent_depth"] == 1
    assert "mastery_mode" not in child.metadata


def test_parent_context_is_not_mutated(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _FakeCapability(content="ok")
    parent = _parent_context()
    _run_tool(cap, monkeypatch, _parent_context=parent)

    assert parent.user_message == "the parent's question"
    assert parent.conversation_history == [{"role": "user", "content": "earlier"}]
    assert "_subagent_depth" not in parent.metadata
    assert parent.metadata["mastery_mode"] is True


def test_chat_delegation_clears_active_capability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A ``chat`` subagent is a plain turn, not a turn tagged 'chat'."""
    cap = _FakeCapability(content="ok")
    _run_tool(cap, monkeypatch, capability="chat")
    assert cap.seen_context is not None
    assert cap.seen_context.active_capability is None


# ── Results and failures ─────────────────────────────────────────────────


def test_result_payload_is_used_when_nothing_streamed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cap = _FakeCapability(result={"response": "from the result envelope"})
    result, _ = _run_tool(cap, monkeypatch)
    assert result.success
    assert "from the result envelope" in result.content


def test_failure_keeps_partial_output(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _FakeCapability(content="got this far", raise_exc=RuntimeError("boom"))
    result, _ = _run_tool(cap, monkeypatch)

    assert not result.success
    assert "boom" in result.content
    assert "got this far" in result.content


def test_child_tokens_fold_into_the_parent_tally(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deeptutor.core.agentic.usage import UsageTracker

    parent_usage = UsageTracker(model="gpt-4o-mini")
    parent_usage.add_estimated(input_chars=350, output_chars=350)
    before = parent_usage.total_tokens

    cap = _FakeCapability(
        content="ok",
        result={
            "response": "ok",
            "metadata": {
                "cost_summary": {
                    "prompt_tokens": 1000,
                    "completion_tokens": 500,
                    "total_tokens": 1500,
                    "total_calls": 3,
                }
            },
        },
    )
    _run_tool(cap, monkeypatch, _usage=parent_usage)

    assert parent_usage.total_tokens == before + 1500
    assert parent_usage.calls == 1 + 3


def test_unknown_capability_is_refused_without_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cap = _FakeCapability(content="should not run")
    result, _ = _run_tool(cap, monkeypatch, capability="not_a_capability")

    assert not result.success
    assert cap.seen_context is None


def test_missing_stream_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _FakeCapability(content="should not run")
    result, _ = _run_tool(cap, monkeypatch, _stream=None)

    assert not result.success
    assert cap.seen_context is None


# ── Registry agreement ───────────────────────────────────────────────────


def test_every_delegable_name_is_a_registered_capability() -> None:
    from deeptutor.runtime.bootstrap.builtin_capabilities import (
        BUILTIN_CAPABILITY_CLASSES,
    )

    assert set(DELEGABLE_CAPABILITIES) <= set(BUILTIN_CAPABILITY_CLASSES)


def test_declared_tool_name_matches_the_definition() -> None:
    assert SUBAGENT_CAPABILITY_TOOL_NAMES == (RunSubagentTool().get_definition().name,)


def test_subagent_turns_do_not_mount_the_delegation_tool() -> None:
    from deeptutor.agents.chat.agentic_pipeline import _is_subagent_turn

    assert _is_subagent_turn(_parent_context(metadata={"_subagent_depth": 1}))
    assert not _is_subagent_turn(_parent_context())


def test_delegated_stream_tolerates_a_closed_parent() -> None:
    """A cancelled turn closes the parent bus mid-delegation."""

    async def scenario() -> None:
        parent = StreamBus()
        await parent.close()
        child = DelegatedStream(parent, capability="visualize", call_id="c1")
        await child.content("still working", source="visualize")
        assert child.outcome.content == "still working"

    asyncio.run(scenario())
