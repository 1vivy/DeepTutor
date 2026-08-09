"""A child capability's event bus, wired into its parent turn's stream.

When one capability delegates to another, the child's events cannot simply go
onto the parent's bus. A turn's transcript is assembled from that bus: content
becomes the assistant's answer, ``RESULT`` becomes the turn's outcome, ``DONE``
ends it. A child writing there directly would splice its prose into the
parent's reply and end the turn on its own behalf.

Nor can the child be given a detached bus. Then its work is invisible — the
user watches a spinner for two minutes with nothing in the Activity panel.

So the two kinds of event are separated:

**Forwarded** — stage boundaries, thinking, observations, tool calls, tool
results, progress, sources. These are *what is happening*, and they belong in
the parent's Activity panel. They pass through with the child's own trace
metadata plus a ``subagent`` marker, which is also what lets the panel's tool
tally credit them.

**Captured** — content, result, done, error. These are *the outcome*, and the
outcome's destination is the delegating tool's return value, not the user's
chat bubble. Content is additionally forwarded as ``thinking`` so the child's
drafting is visible while it happens without competing with the parent's
answer.

``wait_for_input`` is refused outright. On a normal bus it blocks until the
frontend answers; a child holding that lock would hang the parent turn on a
question nobody is being shown. The child gets an empty reply and a recorded
flag so the delegating tool can tell the model its subagent needed input it
could not have.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
from typing import Any

from deeptutor.core.stream import StreamEvent, StreamEventType
from deeptutor.core.stream_bus import StreamBus

logger = logging.getLogger(__name__)

# What is happening — belongs in the parent's Activity panel.
_FORWARDED: frozenset[StreamEventType] = frozenset(
    {
        StreamEventType.STAGE_START,
        StreamEventType.STAGE_END,
        StreamEventType.THINKING,
        StreamEventType.OBSERVATION,
        StreamEventType.TOOL_CALL,
        StreamEventType.TOOL_RESULT,
        StreamEventType.PROGRESS,
        StreamEventType.SOURCES,
    }
)


@dataclass
class DelegationOutcome:
    """Everything the parent needs to report one delegation."""

    capability: str
    content: str = ""
    result: dict[str, Any] = field(default_factory=dict)
    error: str = ""
    sources: list[dict[str, Any]] = field(default_factory=list)
    wanted_input: str = ""

    @property
    def answer(self) -> str:
        """The child's user-facing output, however it chose to deliver it.

        Capabilities are inconsistent here: some stream prose and end, others
        put their payload in ``RESULT``. Both are the answer, so both are
        checked — streamed content first, since a capability that streamed is
        saying its prose *is* the deliverable.
        """
        if self.content.strip():
            return self.content.strip()
        for key in ("response", "content", "answer", "text", "summary"):
            value = self.result.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""


class DelegatedStream(StreamBus):
    """Bus handed to a delegated capability. See the module docstring."""

    def __init__(
        self,
        parent: StreamBus,
        *,
        capability: str,
        call_id: str,
    ) -> None:
        super().__init__()
        self._parent = parent
        self._capability = capability
        self._call_id = call_id
        self.outcome = DelegationOutcome(capability=capability)

    async def emit(self, event: StreamEvent) -> None:
        # Keep the local history intact: the child may subscribe to its own bus
        # (some capabilities consume their own events), and that must behave
        # exactly as an ordinary bus would.
        await super().emit(event)

        if event.type in _FORWARDED:
            await self._forward(event, event.type)
            if event.type == StreamEventType.SOURCES:
                extra = (event.metadata or {}).get("sources")
                if isinstance(extra, list):
                    self.outcome.sources.extend(item for item in extra if isinstance(item, dict))
            return

        if event.type == StreamEventType.CONTENT:
            self.outcome.content += event.content or ""
            # Visible as reasoning, not as the parent's reply.
            await self._forward(event, StreamEventType.THINKING)
            return

        if event.type == StreamEventType.RESULT:
            # ``StreamBus.result(data)`` merges the payload *into* the event's
            # metadata rather than nesting it under a key, so the metadata dict
            # IS the capability's result envelope (plus any trace keys, which
            # are harmless extras here).
            if isinstance(event.metadata, dict):
                self.outcome.result.update(event.metadata)
            if event.content:
                self.outcome.result.setdefault("content", event.content)
            return

        if event.type == StreamEventType.ERROR:
            self.outcome.error = (event.content or "").strip() or "subagent failed"
            # Surfaced as progress so the panel shows the failure in place
            # instead of the turn appearing to error out.
            await self._forward(event, StreamEventType.PROGRESS)
            return

        # DONE / SESSION / SESSION_META / WAIT_FOR_INPUT: the child does not get
        # to end, rename or interrupt the parent's turn.

    async def _forward(self, event: StreamEvent, as_type: StreamEventType) -> None:
        try:
            await self._parent.emit(
                StreamEvent(
                    type=as_type,
                    source=event.source,
                    stage=event.stage,
                    content=event.content,
                    metadata={
                        **(event.metadata or {}),
                        "subagent": self._capability,
                        "subagent_call_id": self._call_id,
                    },
                )
            )
        except Exception:
            # A parent bus that has already closed (turn cancelled) must not
            # take the child down with it — it is finishing into a void, which
            # is harmless.
            logger.debug("forwarding subagent event failed", exc_info=True)

    async def wait_for_input(
        self,
        prompt: str,
        source: str = "",
        stage: str = "",
        timeout: float | None = None,
    ) -> str:
        """Refuse to block. See the module docstring."""
        _ = (source, stage, timeout)
        self.outcome.wanted_input = (prompt or "").strip() or "(unspecified)"
        return ""


__all__ = ["DelegatedStream", "DelegationOutcome"]
