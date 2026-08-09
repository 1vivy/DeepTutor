"""Automatic memory upkeep — keep L1 current without a manual Refresh.

Until now a conversation only entered memory when the user opened the Memory
workbench and pressed Refresh. That button does two unrelated-looking things,
and only one of them is cheap:

* it reconciles the **L1 workspace mirror** — diff the workspace against the
  last persisted fingerprints, append the changes to the log. No model call.
* nothing else. The **L1→L2 consolidation** is a separate, per-surface button,
  and it is one LLM call per chunk.

This module automates both, under two independent switches (see
:class:`~deeptutor.services.memory.settings.AutopilotSettings`), and is the
only place that decides *when* upkeep happens. Callers merely report that
something happened::

    from deeptutor.services.memory import autopilot
    autopilot.schedule_upkeep(reason="chat_turn")

Design notes
------------
**One notification, all surfaces.** ``schedule_upkeep`` takes no surface. A
per-surface API would need a call site in every producer (chat, quiz,
notebook, book, co-writer, kb, partner) and would silently rot the moment a
new producer forgot to add one. Reconciling every surface costs ~18 ms total
on the probe path, so the simple thing is also the affordable thing.

**Never on the caller's critical path.** Upkeep runs in a background task and
file I/O goes to a worker thread, mirroring
:func:`~deeptutor.runtime.memory_reclaim.schedule_memory_reclaim`. Failures
are logged and swallowed: memory upkeep must never fail the turn that
triggered it.

**Per-scope state.** Memory paths resolve through the active user's
``PathService``, so debounce bookkeeping is keyed by workspace root — one
user's activity must not suppress another's upkeep. ``asyncio.to_thread`` and
``create_task`` both propagate the caller's context, so the scope in force
when upkeep was scheduled is the scope it runs under.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging
import threading
import time
from typing import Any

from deeptutor.services.memory.paths import SURFACES, Surface
from deeptutor.services.memory.settings import AutopilotSettings, load_memory_settings

logger = logging.getLogger(__name__)

# Debounce + cooldown bookkeeping, keyed by workspace scope.
_state_lock = threading.Lock()
_last_snapshot_sync: dict[str, float] = {}
_last_consolidate: dict[str, float] = {}
_inflight: dict[str, asyncio.Task[Any]] = {}


@dataclass(frozen=True, slots=True)
class UpkeepReport:
    """What one upkeep pass actually did. Returned for tests and logging."""

    scope: str
    reason: str
    surfaces_refreshed: tuple[str, ...] = ()
    changes: int = 0
    consolidations_started: tuple[str, ...] = ()
    skipped: str = ""

    @property
    def did_work(self) -> bool:
        return bool(self.surfaces_refreshed or self.consolidations_started)


def _scope_key() -> str:
    """Stable identity for the active memory scope.

    Keyed off the resolved memory root rather than a user id: memory paths can
    be overridden per turn (a partner runtime borrows the owner's memory), and
    the thing we must not mix up is the directory being reconciled.
    """
    try:
        from deeptutor.services.memory.paths import memory_root

        return str(memory_root())
    except Exception:  # pragma: no cover - defensive
        return "<unresolved>"


def schedule_upkeep(*, reason: str = "") -> asyncio.Task[Any] | None:
    """Report workspace activity; reconcile memory in the background.

    Returns the scheduled task (or the already-pending one) so callers that
    care — tests, mainly — can await it. Returns ``None`` when there is no
    running loop or upkeep is switched off. Never raises.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None

    scope = _scope_key()
    with _state_lock:
        pending = _inflight.get(scope)
        if pending is not None and not pending.done():
            # A pass is already queued for this scope; it will observe
            # whatever this activity produced when it reads the workspace.
            return pending

    async def _go() -> UpkeepReport | None:
        # Yield once so the triggering coroutine finishes and releases its
        # locals before we start reading the workspace.
        await asyncio.sleep(0)
        try:
            return await run_upkeep(reason=reason)
        except Exception:
            logger.warning("memory upkeep failed (reason=%s)", reason, exc_info=True)
            return None
        finally:
            with _state_lock:
                if _inflight.get(scope) is task:
                    _inflight.pop(scope, None)

    task = loop.create_task(_go())
    with _state_lock:
        _inflight[scope] = task
    return task


async def run_upkeep(*, reason: str = "", force: bool = False) -> UpkeepReport:
    """Reconcile L1 now (and consolidate if warranted). Awaitable entry point.

    ``force`` bypasses the debounce — used by an explicit user-driven refresh
    that wants the automatic path's behaviour without its rate limiting.
    """
    settings = load_memory_settings().autopilot
    scope = _scope_key()

    if settings.snapshot != "auto" and settings.consolidate != "auto":
        return UpkeepReport(scope=scope, reason=reason, skipped="disabled")

    report = UpkeepReport(scope=scope, reason=reason)

    if settings.snapshot == "auto":
        if not force and not _claim_snapshot_slot(scope, settings):
            report = UpkeepReport(scope=scope, reason=reason, skipped="debounced")
        else:
            refreshed, changes = await asyncio.to_thread(_refresh_all_surfaces)
            report = UpkeepReport(
                scope=scope,
                reason=reason,
                surfaces_refreshed=refreshed,
                changes=changes,
            )

    if settings.consolidate == "auto":
        started = await _maybe_consolidate(scope, settings)
        if started:
            report = UpkeepReport(
                scope=report.scope,
                reason=report.reason,
                surfaces_refreshed=report.surfaces_refreshed,
                changes=report.changes,
                consolidations_started=started,
                skipped=report.skipped,
            )

    if report.did_work:
        logger.debug(
            "memory upkeep reason=%s surfaces=%d changes=%d consolidated=%s",
            reason,
            len(report.surfaces_refreshed),
            report.changes,
            report.consolidations_started or "-",
        )
    return report


def _claim_snapshot_slot(scope: str, settings: AutopilotSettings) -> bool:
    """Reserve the right to reconcile now, or report that it is too soon."""
    now = time.monotonic()
    with _state_lock:
        last = _last_snapshot_sync.get(scope, 0.0)
        if now - last < settings.debounce_seconds:
            return False
        _last_snapshot_sync[scope] = now
    return True


def _refresh_all_surfaces() -> tuple[tuple[str, ...], int]:
    """Reconcile every surface's mirror. Blocking; call in a worker thread.

    Only surfaces that actually moved are reported, so an idle upkeep pass
    logs nothing and writes nothing (``refresh_snapshot`` is a no-op when the
    diff is empty).
    """
    from deeptutor.services.memory import snapshot as snap

    touched: list[str] = []
    total = 0
    for surface in SURFACES:
        try:
            changes = snap.refresh_snapshot(surface)
        except Exception:
            logger.warning("autopilot refresh failed surface=%s", surface, exc_info=True)
            continue
        if changes:
            touched.append(surface)
            total += len(changes)
    return tuple(touched), total


def unconsolidated_count(surface: Surface) -> int:
    """How many workspace entities L2 has never folded in for *surface*.

    This — not the trace backlog, and not the snapshot's pending diff — is the
    signal that an L1→L2 pass has something to do. ``run_update`` decides what
    is new by comparing entity refs against ``l2_meta.seen_entity_refs``, so
    that is what we count. Reads stamps, never content: identity is all the
    comparison needs.
    """
    from deeptutor.services.memory.consolidator.meta import load_l2_meta
    from deeptutor.services.memory.snapshot import adapters

    try:
        seen = load_l2_meta(surface).seen_entity_refs
        stamps = adapters.read_stamps(surface)
    except Exception:
        logger.warning("unconsolidated count failed surface=%s", surface, exc_info=True)
        return 0
    return sum(1 for stamp in stamps if f"{surface}:{stamp.id}" not in seen)


async def _maybe_consolidate(scope: str, settings: AutopilotSettings) -> tuple[str, ...]:
    """Start L1→L2 runs for surfaces that have accumulated enough new input."""
    now = time.monotonic()
    with _state_lock:
        last = _last_consolidate.get(scope, 0.0)
        if now - last < settings.consolidate_cooldown_seconds:
            return ()

    counts = await asyncio.to_thread(_count_all_unconsolidated)
    ready = [surface for surface, count in counts.items() if count >= settings.consolidate_after]
    if not ready:
        return ()

    with _state_lock:
        # Re-check under the lock: another pass may have claimed the slot
        # while we were counting.
        if now - _last_consolidate.get(scope, 0.0) < settings.consolidate_cooldown_seconds:
            return ()
        _last_consolidate[scope] = now

    started: list[str] = []
    for surface in ready:
        if await _start_l2_update(surface):
            started.append(surface)
    return tuple(started)


def _count_all_unconsolidated() -> dict[str, int]:
    return {surface: unconsolidated_count(surface) for surface in SURFACES}


async def _start_l2_update(surface: Surface) -> bool:
    """Kick off one L1→L2 run through the same manager the workbench uses.

    Going through :class:`RunManager` rather than calling ``run_update``
    directly is deliberate: the run then shows up in the workbench's run list,
    is cancellable, and — crucially — collides with a user-started run on the
    same surface instead of racing it (``RunBusyError``).
    """
    from deeptutor.services.memory.consolidator import run_update
    from deeptutor.services.memory.consolidator.runs import RunBusyError, get_run_manager

    async def runner(on_event: Any) -> None:
        await run_update("L2", surface, on_event=on_event)

    try:
        await get_run_manager().start(
            layer="L2",
            key=surface,
            mode="update",
            runner=runner,
            params={"trigger": "autopilot"},
        )
    except RunBusyError:
        return False
    except Exception:
        logger.warning("autopilot consolidate failed surface=%s", surface, exc_info=True)
        return False
    return True


def reset_state_for_tests() -> None:
    """Clear debounce/cooldown bookkeeping between tests."""
    with _state_lock:
        _last_snapshot_sync.clear()
        _last_consolidate.clear()
        _inflight.clear()


__all__ = [
    "UpkeepReport",
    "reset_state_for_tests",
    "run_upkeep",
    "schedule_upkeep",
    "unconsolidated_count",
]
