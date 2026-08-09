"""Delegating a goal to another capability, as a tool.

Every deep mode in this product is a capability with the same shape —
``run(context, stream)``. Until now the only way to reach one was for the user
to pick it in the composer before typing, which makes the *user* responsible
for knowing that "draw me the state machine" is a ``visualize`` job and "find
the papers on this" is a ``deep_research`` job.

This tool turns that inside out: the agent picks. Research, quiz generation,
visualization, multi-step solving, mastery tutoring — and plain chat — become
subagents it can hand a goal to, each running its own loop with its own tools.

Three things are load-bearing:

**The child cannot hijack the turn.** It runs on a
:class:`~deeptutor.core.delegated_stream.DelegatedStream`, which forwards
progress into the parent's Activity panel but captures content and results as
this tool's return value. See that module for why both halves are necessary.

**The child cannot recurse.** A subagent that could delegate would let a single
turn fan out without bound; depth is stamped into the child's metadata and
checked here.

**The child cannot escape the user's scope.** The child context is derived from
the parent's, so the model grant, workspace paths and session identity are
whatever the parent turn already established — a delegation cannot reach
anything the turn itself could not.
"""

from __future__ import annotations

import json
from typing import Any

from deeptutor.core.tool_protocol import (
    BaseTool,
    ToolDefinition,
    ToolParameter,
    ToolResult,
)

# Import-cycle discipline as in ``memory_access`` / ``partner_memory``: this
# module is imported by ``tools.builtin`` while that module is still executing,
# so anything under ``deeptutor.services`` / ``deeptutor.runtime`` is imported
# inside the function that needs it.

# Capabilities offered as subagents, with the one-line pitch the model chooses
# from. Mirrors ``BUILTIN_CAPABILITY_CLASSES``; a name absent here is simply not
# delegable, which is the safe direction for anything newly registered.
# ``tests/tools/test_subagent_capability.py`` asserts every name still resolves.
_DELEGABLE: dict[str, str] = {
    "deep_research": (
        "Comprehensive multi-agent research across the web and papers. Slow and "
        "thorough; use for open questions needing many sources, not lookups."
    ),
    "deep_question": (
        "Generate quiz questions with validated answers on a topic. Use when "
        "the goal is to test or drill the learner."
    ),
    "deep_solve": (
        "Multi-step reasoning over a hard problem, with code execution and "
        "search. Use for problems that need worked steps, not recall."
    ),
    "visualize": (
        "Produce a chart, diagram, or interactive page from a description or "
        "data. Use when the answer is better seen than read."
    ),
    "math_animator": (
        "Render a mathematical animation (Manim) of a concept or process. Use "
        "when motion over time is the explanation."
    ),
    "mastery_path": (
        "Mastery-based tutoring against the learner's skill map, with a hard "
        "per-objective gate and spaced review. Use to advance a learning path."
    ),
    "chat": (
        "A general assistant turn with the full ordinary tool surface. Use to "
        "hand off a self-contained sub-question you want answered "
        "independently of this conversation."
    ),
}

_DEPTH_KEY = "_subagent_depth"
# Answers are folded back into the parent conversation, so an unbounded child
# answer would blow the parent's context window. Long-form deliverables reach
# the user through the artifacts the child writes, not through this string.
_MAX_ANSWER_CHARS = 12000


def _capability_menu() -> str:
    return "\n".join(f"- {name}: {pitch}" for name, pitch in _DELEGABLE.items())


class RunSubagentTool(BaseTool):
    """Hand a goal to another capability and report what it produced."""

    def get_definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="run_subagent",
            description=(
                "Delegate a self-contained goal to a specialist capability, "
                "which runs its own agent loop with its own tools and reports "
                "back. Its progress is visible to the user in the Activity "
                "panel while it works. Available subagents:\n"
                f"{_capability_menu()}\n"
                "Give a complete, standalone goal — the subagent does not see "
                "this conversation. Prefer answering directly when you can; "
                "delegate when the work genuinely needs another mode."
            ),
            parameters=[
                ToolParameter(
                    name="capability",
                    type="string",
                    description="Which subagent to run.",
                    required=True,
                    enum=list(_DELEGABLE),
                ),
                ToolParameter(
                    name="goal",
                    type="string",
                    description=(
                        "The complete, self-contained instruction. Include any "
                        "context the subagent needs — it cannot see this "
                        "conversation."
                    ),
                    required=True,
                ),
            ],
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        capability_name = str(kwargs.get("capability") or "").strip()
        goal = str(kwargs.get("goal") or "").strip()
        parent_context = kwargs.get("_parent_context")
        parent_stream = kwargs.get("_stream")
        parent_usage = kwargs.get("_usage")

        if capability_name not in _DELEGABLE:
            return ToolResult(
                content=(
                    f"Unknown subagent {capability_name!r}. Choose one of: {', '.join(_DELEGABLE)}."
                ),
                success=False,
            )
        if not goal:
            return ToolResult(
                content="run_subagent needs a goal describing what to produce.",
                success=False,
            )
        if parent_context is None or parent_stream is None:
            # Only reachable if the tool is mounted by a pipeline that does not
            # inject the turn's stream/context — say so plainly rather than
            # silently running detached and invisible.
            return ToolResult(
                content="Delegation is unavailable in this context.",
                success=False,
            )

        depth = int((parent_context.metadata or {}).get(_DEPTH_KEY) or 0)
        if depth:
            return ToolResult(
                content=(
                    "You are already running as a subagent and cannot delegate "
                    "further. Complete the goal with your own tools."
                ),
                success=False,
            )

        return await self._delegate(
            capability_name=capability_name,
            goal=goal,
            parent_context=parent_context,
            parent_stream=parent_stream,
            parent_usage=parent_usage,
        )

    async def _delegate(
        self,
        *,
        capability_name: str,
        goal: str,
        parent_context: Any,
        parent_stream: Any,
        parent_usage: Any,
    ) -> ToolResult:
        from deeptutor.core.delegated_stream import DelegatedStream
        from deeptutor.core.trace import new_call_id
        from deeptutor.runtime.registry.capability_registry import get_capability_registry

        capability = get_capability_registry().get(capability_name)
        if capability is None:
            return ToolResult(
                content=(
                    f"Subagent {capability_name!r} is registered as available but "
                    "could not be loaded."
                ),
                success=False,
            )

        call_id = new_call_id(f"subagent-{capability_name}")
        child_stream = DelegatedStream(
            parent_stream,
            capability=capability_name,
            call_id=call_id,
        )
        child_context = _derive_child_context(parent_context, goal, capability_name)

        try:
            await capability.run(child_context, child_stream)
        except Exception as exc:
            outcome = child_stream.outcome
            _absorb_usage(parent_usage, outcome)
            partial = outcome.answer
            body = f"The {capability_name} subagent failed: {exc}"
            if partial:
                body += f"\n\nPartial output before the failure:\n{partial[:2000]}"
            return ToolResult(content=body, success=False)
        finally:
            await child_stream.close()

        outcome = child_stream.outcome
        _absorb_usage(parent_usage, outcome)

        if outcome.error and not outcome.answer:
            return ToolResult(
                content=f"The {capability_name} subagent reported: {outcome.error}",
                success=False,
            )

        answer = outcome.answer
        if not answer:
            note = f"The {capability_name} subagent finished without producing text."
            if outcome.wanted_input:
                note += (
                    " It tried to ask the learner a question "
                    f"({outcome.wanted_input!r}), which a subagent cannot do — "
                    "either ask it yourself and delegate again with the answer "
                    "included in the goal, or handle this directly."
                )
            return ToolResult(content=note, success=False)

        truncated = len(answer) > _MAX_ANSWER_CHARS
        payload: dict[str, Any] = {
            "capability": capability_name,
            "answer": answer[:_MAX_ANSWER_CHARS],
        }
        if truncated:
            payload["truncated"] = True
        if outcome.wanted_input:
            payload["note"] = (
                "The subagent wanted to ask the learner "
                f"{outcome.wanted_input!r} and proceeded without an answer."
            )
        if outcome.sources:
            payload["sources"] = outcome.sources[:20]
        artifacts = _artifacts_from(outcome.result)
        if artifacts:
            payload["artifacts"] = artifacts

        return ToolResult(
            content=json.dumps(payload, ensure_ascii=False, indent=2),
            metadata={
                "run_subagent": {
                    "capability": capability_name,
                    "call_id": call_id,
                    "goal": goal,
                },
                # Sources travel in the standard slot so the parent turn cites
                # a delegated finding exactly as it cites its own.
                "sources": outcome.sources,
            },
        )


def _derive_child_context(parent: Any, goal: str, capability_name: str) -> Any:
    """Build the subagent's context from the parent turn's.

    Carried over: session identity, language, knowledge bases, attachments,
    config overrides — everything that defines *whose* turn this is and what it
    may touch. Deliberately dropped:

    * ``conversation_history`` — the child is given a standalone goal on
      purpose. Replaying the parent's transcript would double the token cost of
      every delegation and invite the child to answer the user's last message
      instead of its assignment.
    * ``enabled_tools`` — the child capability composes its own tool surface.
    * ``memory_context`` / ``persona_context`` — the parent's system-prompt
      injections belong to the parent's voice.
    """
    from dataclasses import replace

    metadata = dict(parent.metadata or {})
    metadata[_DEPTH_KEY] = int(metadata.get(_DEPTH_KEY) or 0) + 1
    metadata["_subagent_parent_capability"] = parent.active_capability or "chat"
    # A delegated turn is not a Tutor-workspace turn of its own; leaving these
    # set would make the child mount tutor/mastery context it was not asked for.
    metadata.pop("mastery_mode", None)

    return replace(
        parent,
        user_message=goal,
        conversation_history=[],
        enabled_tools=None,
        active_capability=None if capability_name == "chat" else capability_name,
        memory_context="",
        persona_context="",
        metadata=metadata,
    )


def _absorb_usage(parent_usage: Any, outcome: Any) -> None:
    """Fold the child's token spend into the parent turn's tally."""
    if parent_usage is None:
        return
    meta = outcome.result.get("metadata")
    summary = meta.get("cost_summary") if isinstance(meta, dict) else None
    absorb = getattr(parent_usage, "absorb", None)
    if callable(absorb) and isinstance(summary, dict):
        absorb(summary)


def _artifacts_from(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Files the child produced, if it reported any.

    Capabilities name this differently (``artifacts`` / ``attachments`` /
    ``files``); all three are accepted so a visualize or animation delegation
    can tell the parent what it wrote.
    """
    for key in ("artifacts", "attachments", "files"):
        value = result.get(key)
        if isinstance(value, list) and value:
            return [item for item in value if isinstance(item, dict)][:20]
    return []


SUBAGENT_CAPABILITY_TOOL_TYPES: tuple[type[BaseTool], ...] = (RunSubagentTool,)

# Spelled out for the same import-cycle reason as in ``memory_access``.
SUBAGENT_CAPABILITY_TOOL_NAMES: tuple[str, ...] = ("run_subagent",)

DELEGABLE_CAPABILITIES: tuple[str, ...] = tuple(_DELEGABLE)

__all__ = [
    "DELEGABLE_CAPABILITIES",
    "SUBAGENT_CAPABILITY_TOOL_NAMES",
    "SUBAGENT_CAPABILITY_TOOL_TYPES",
    "RunSubagentTool",
]
