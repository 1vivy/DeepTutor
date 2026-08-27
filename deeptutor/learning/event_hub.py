"""Low-latency wake-up channel for durable Mastery Topic events.

SQLite remains the replay authority.  This hub only tells connected clients
that a committed topic changed so they can read the durable event tail and
refresh the map immediately.  Publishing is synchronous and thread-safe,
which lets learning transactions running inside ``asyncio.to_thread`` wake an
uvicorn WebSocket loop without owning that loop.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import itertools
import threading


@dataclass(frozen=True)
class TopicSignal:
    path_id: str
    revision: int
    reason: str
    sequence: int


class TopicSubscription:
    def __init__(self, hub: "MasteryTopicEventHub", path_id: str) -> None:
        self._hub = hub
        self.path_id = path_id
        self.queue: asyncio.Queue[TopicSignal] = asyncio.Queue()
        self.loop = asyncio.get_running_loop()
        self._closed = False
        self._hub._add(self)

    async def get(self) -> TopicSignal:
        return await self.queue.get()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._hub._remove(self)


class MasteryTopicEventHub:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._subscriptions: dict[str, set[TopicSubscription]] = {}
        self._sequence = itertools.count(1)

    def subscribe(self, path_id: str) -> TopicSubscription:
        return TopicSubscription(self, str(path_id))

    def _add(self, subscription: TopicSubscription) -> None:
        with self._lock:
            self._subscriptions.setdefault(subscription.path_id, set()).add(subscription)

    def _remove(self, subscription: TopicSubscription) -> None:
        with self._lock:
            group = self._subscriptions.get(subscription.path_id)
            if not group:
                return
            group.discard(subscription)
            if not group:
                self._subscriptions.pop(subscription.path_id, None)

    def publish(self, path_id: str, revision: int, reason: str = "topic.changed") -> None:
        with self._lock:
            signal = TopicSignal(
                path_id=str(path_id),
                revision=max(0, int(revision)),
                reason=str(reason or "topic.changed"),
                sequence=next(self._sequence),
            )
            subscriptions = list(self._subscriptions.get(signal.path_id, ()))
        for subscription in subscriptions:
            if subscription.loop.is_closed():
                subscription.close()
                continue
            try:
                subscription.loop.call_soon_threadsafe(
                    subscription.queue.put_nowait,
                    signal,
                )
            except RuntimeError:
                subscription.close()


mastery_topic_event_hub = MasteryTopicEventHub()


def publish_topic_signal(path_id: str, revision: int, reason: str = "topic.changed") -> None:
    mastery_topic_event_hub.publish(path_id, revision, reason)


__all__ = [
    "MasteryTopicEventHub",
    "TopicSignal",
    "TopicSubscription",
    "mastery_topic_event_hub",
    "publish_topic_signal",
]

