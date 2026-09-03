"""Lifecycle and configuration tests for the remote Hermes backend."""

from __future__ import annotations

import json
from typing import Any

import anyio
import httpx
import pytest

from deeptutor.services.subagent.config import BackendConfig, settings_from_dict
from deeptutor.services.subagent.hermes_remote import HermesRemoteBackend
from deeptutor.services.subagent.types import EVENT_ERROR, EVENT_LOG
from tests.services.test_hermes_remote_backend import _backend, _HermesTransport


@pytest.mark.asyncio
async def test_approval_is_denied_without_blocking(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_HERMES_KEY", "synthetic-secret")
    transport = _HermesTransport(
        events=[
            {"event": "approval.request", "tool": "exec"},
            {"event": "run.completed", "output": "finished"},
        ],
    )
    backend = _backend(transport, auto_approve=False)
    emitted: list[Any] = []

    async def on_event(event: Any) -> None:
        emitted.append(event)

    result = await backend.consult("question", on_event=on_event, config=backend.config)
    assert result.success is True
    assert result.final_text == "finished"
    assert transport.approvals == [{"choice": "deny"}]
    assert any(event.kind == EVENT_LOG and "denied" in event.text for event in emitted)


@pytest.mark.asyncio
async def test_consult_http_error_never_leaks_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "synthetic-secret"
    monkeypatch.setenv("TEST_HERMES_KEY", secret)

    def unauthorized(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=f"invalid token {secret}")

    backend = _backend(httpx.MockTransport(unauthorized))
    emitted: list[Any] = []

    async def on_event(event: Any) -> None:
        emitted.append(event)

    result = await backend.consult("question", on_event=on_event, config=backend.config)
    assert result.success is False
    assert emitted[-1].kind == EVENT_ERROR
    assert secret not in emitted[-1].text
    assert secret not in result.error


@pytest.mark.asyncio
async def test_cancellation_posts_stop_and_reraises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_HERMES_KEY", "synthetic-secret")
    transport = _HermesTransport()
    transport.blocking = True
    backend = _backend(transport)
    cancellation: list[BaseException] = []

    async def on_event(_: Any) -> None:
        return None

    async def run_consult() -> None:
        try:
            await backend.consult("question", on_event=on_event, config=backend.config)
        except BaseException as exc:  # noqa: BLE001 - assert cancellation propagation
            cancellation.append(exc)
            raise

    async with anyio.create_task_group() as group:
        group.start_soon(run_consult)
        await transport.block_started.wait()
        group.cancel_scope.cancel()

    assert cancellation
    assert isinstance(cancellation[0], anyio.get_cancelled_exc_class())
    assert transport.stops == ["run-1"]


@pytest.mark.asyncio
async def test_idle_timeout_stops_run(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_HERMES_KEY", "synthetic-secret")
    transport = _HermesTransport()
    transport.blocking = True
    backend = HermesRemoteBackend(
        config=BackendConfig(
            base_url="http://hermes.test",
            api_key_env="TEST_HERMES_KEY",
            idle_timeout_seconds=0,
        ),
        transport=httpx.MockTransport(transport),
    )
    emitted: list[Any] = []

    async def on_event(event: Any) -> None:
        emitted.append(event)

    result = await backend.consult("question", on_event=on_event, config=backend.config)
    assert result.success is False
    assert "idle_timeout" in result.error
    assert emitted[-1].kind == EVENT_ERROR
    assert transport.stops == ["run-1"]

@pytest.mark.asyncio
async def test_missing_session_history_starts_fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_HERMES_KEY", "synthetic-secret")
    transport = _HermesTransport(
        events=[{"event": "run.completed", "output": "fresh"}],
        history_status=404,
    )
    backend = _backend(transport)

    async def on_event(_: Any) -> None:
        return None

    config = BackendConfig(
        base_url="http://hermes.test",
        api_key_env="TEST_HERMES_KEY",
        system_prompt="reapply this instruction",
    )
    result = await backend.consult(
        "question",
        on_event=on_event,
        session_id="session-gone",
        config=config,
    )
    body = json.loads(transport.requests[1].content)
    assert result.success is True
    assert transport.requests[0].url.path == "/api/sessions/session-gone/messages"
    assert body["session_id"] == "session-gone"
    assert "conversation_history" not in body
    assert body["instructions"].startswith("reapply this instruction")


def test_settings_persist_remote_fields_without_inline_secret() -> None:
    settings = settings_from_dict(
        {
            "backends": {
                "hermes_remote": {
                    "base_url": " http://hermes.test ",
                    "api_key_env": " TEST_HERMES_KEY ",
                    "profile": "study",
                    "idle_timeout_seconds": "42",
                    "api_key": "must-never-persist",
                },
            },
        },
    )
    config = settings.backend("hermes_remote")
    serialized = settings.to_dict()["backends"]["hermes_remote"]
    assert config.base_url == "http://hermes.test"
    assert config.api_key_env == "TEST_HERMES_KEY"
    assert config.profile == "study"
    assert config.idle_timeout_seconds == 42
    assert "api_key" not in serialized
    assert serialized["api_key_env"] == "TEST_HERMES_KEY"


@pytest.mark.asyncio
async def test_detect_remote_backend_is_registered(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_HERMES_KEY", "synthetic-secret")
    transport = httpx.MockTransport(
        lambda _: httpx.Response(200, json={"object": "list", "data": [{"id": "hermes"}]}),
    )
    backend = HermesRemoteBackend(
        config=BackendConfig(base_url="http://hermes.test", api_key_env="TEST_HERMES_KEY"),
        transport=transport,
    )
    assert backend.local_cli is False
    assert backend.detectable is True
    result = await backend.detect()
    assert result.available is True
