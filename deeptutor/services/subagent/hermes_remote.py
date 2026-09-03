"""Connected Agents backend for a remote Hermes Agent gateway."""

from __future__ import annotations

import os
from typing import Any

import anyio
import httpx

from deeptutor.services.subagent.base import OnEvent, SubagentBackend
from deeptutor.services.subagent.config import BackendConfig, load_subagent_settings
from deeptutor.services.subagent.hermes_remote_client import (
    HermesRemoteClient,
    HermesRemoteHTTPError,
    HermesRemoteProtocolError,
)
from deeptutor.services.subagent.hermes_remote_events import HermesRemoteEventMapper
from deeptutor.services.subagent.types import (
    EVENT_ERROR,
    ConsultResult,
    DetectResult,
    SubagentEvent,
)

CONSULT_ORIGIN_INSTRUCTION = (
    "Caller identity: DeepTutor Connected Agents. Answer the user's question directly; "
    "do not route the question to DeepTutor."
)


class HermesRemoteBackend(SubagentBackend):
    """Drive the Hermes gateway's authenticated ``/v1/runs`` API."""

    kind = "hermes_remote"
    display_name = "Hermes Agent (remote)"
    cli_command = ""
    local_cli = False
    detectable = True

    def __init__(
        self,
        config: BackendConfig | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._configured = config
        self._transport = transport

    @property
    def config(self) -> BackendConfig:
        """Return injected config, or the persisted remote-backend settings."""
        return self._configured or load_subagent_settings().backend(self.kind)

    def _client(self, config: BackendConfig, key: str) -> HermesRemoteClient:
        return HermesRemoteClient(config.base_url, key, transport=self._transport)

    async def detect(self) -> DetectResult:
        """Probe ``/v1/models`` and classify configuration/network failures."""
        config = self.config
        if not config.base_url:
            return self._detection(False, "not_configured")
        key = os.environ.get(config.api_key_env, "").strip()
        if not key:
            return self._detection(False, "key_missing")
        try:
            async with self._client(config, key) as client:
                payload = await client.get_json("/v1/models")
        except HermesRemoteHTTPError as exc:
            detail = "unauthorized" if exc.status_code in (401, 403) else "incompatible"
            return self._detection(False, detail)
        except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError):
            return self._detection(False, "unreachable")
        except HermesRemoteProtocolError:
            return self._detection(False, "incompatible")
        models = payload.get("data")
        if payload.get("object") != "list" or not isinstance(models, list):
            return self._detection(False, "incompatible")
        version = ""
        if models and isinstance(models[0], dict):
            version = str(models[0].get("id") or "")
        return self._detection(True, "", version=version or "Hermes API")

    def _detection(self, available: bool, detail: str, *, version: str = "") -> DetectResult:
        return DetectResult(
            kind=self.kind,
            display_name=self.display_name,
            available=available,
            version=version,
            detail=detail,
        )

    async def consult(
        self,
        question: str,
        *,
        on_event: OnEvent,
        cwd: str | None = None,  # noqa: ARG002 - remote gateway owns its cwd
        session_id: str | None = None,
        config: BackendConfig | None = None,
        images: list[str] | None = None,
        partner_id: str | None = None,  # noqa: ARG002 - partner-only
    ) -> ConsultResult:
        """Submit a run, translate its SSE lifecycle, and return its session id."""
        run_config = config or self.config
        result = ConsultResult(session_id=session_id)
        emitted_text = ""
        run_id: str | None = None
        key = os.environ.get(run_config.api_key_env, "").strip()

        async def emit(
            kind: str,
            text: str,
            raw: dict[str, Any],
            meta: dict[str, Any] | None = None,
        ) -> None:
            result.event_count += 1
            await on_event(
                SubagentEvent(
                    kind=kind,
                    text=self._redact(text, key),
                    raw=self._redact_raw(raw, key),
                    meta=meta or {},
                ),
            )

        if not run_config.base_url:
            result.success = False
            result.error = "not_configured"
            await emit(EVENT_ERROR, result.error, {})
            return result
        if not key:
            result.success = False
            result.error = "key_missing"
            await emit(EVENT_ERROR, result.error, {})
            return result

        prompt = question
        if images:
            prompt += "\n\nAttached image paths (the remote gateway has no image upload API):\n"
            prompt += "\n".join(f"- {path}" for path in images)
        try:
            async with self._client(run_config, key) as client:
                session_gone = False
                history: list[dict[str, str]] | None = None
                if session_id:
                    try:
                        history = await client.get_session_history(session_id)
                    except HermesRemoteHTTPError as exc:
                        if exc.status_code != 404:
                            raise
                        session_gone = True
                instructions = CONSULT_ORIGIN_INSTRUCTION
                if run_config.system_prompt.strip() and (not session_id or session_gone):
                    instructions = f"{run_config.system_prompt.strip()}\n\n{instructions}"
                payload: dict[str, Any] = {"input": prompt, "instructions": instructions}
                if session_id:
                    payload["session_id"] = session_id
                if history is not None:
                    payload["conversation_history"] = history
                if run_config.model:
                    payload["model"] = run_config.model
                if run_config.effort:
                    payload["model_options"] = {"reasoning_effort": run_config.effort}
                headers = self._session_headers(session_id)
                started = await client.post_json("/v1/runs", payload, headers=headers or None)
                run_id = self._run_id(started)
                result.session_id = str(started.get("session_id") or session_id or run_id)
                mapper = HermesRemoteEventMapper(
                    client,
                    run_id,
                    result,
                    emit,
                    auto_approve=run_config.auto_approve,
                )
                events = client.stream_events(run_id)
                iterator = events.__aiter__()
                while True:
                    try:
                        with anyio.fail_after(max(0.001, run_config.idle_timeout_seconds)):
                            event = await anext(iterator)
                    except StopAsyncIteration:
                        break
                    except TimeoutError:
                        await self._stop_client(client, run_id)
                        result.success = False
                        result.error = "idle_timeout"
                        await emit(EVENT_ERROR, result.error, {})
                        return result
                    emitted_text = await mapper.handle(event, emitted_text)
                    if event.get("event") in {"run.completed", "run.failed", "run.cancelled"}:
                        break
        except anyio.get_cancelled_exc_class():
            if run_id:
                await self._stop_after_cancel(run_config, key, run_id)
            raise
        except HermesRemoteHTTPError as exc:
            result.success = False
            result.error = self._http_error(exc.status_code)
            await emit(EVENT_ERROR, result.error, {})
        except HermesRemoteProtocolError as exc:
            result.success = False
            result.error = exc.code
            await emit(EVENT_ERROR, result.error, {})
        except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError):
            result.success = False
            result.error = "unreachable"
            await emit(EVENT_ERROR, result.error, {})

        if result.success and not result.final_text:
            result.success = False
            result.error = "empty_response"
            await emit(EVENT_ERROR, result.error, {})
        return result


    @staticmethod
    def _run_id(payload: dict[str, Any]) -> str:
        run_id = payload.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            raise HermesRemoteProtocolError("missing_run_id")
        return run_id

    @staticmethod
    def _session_headers(session_id: str | None) -> dict[str, str]:
        if not session_id:
            return {}
        return {"X-Hermes-Session-Id": session_id, "X-Hermes-Session": session_id}

    async def _stop_after_cancel(self, config: BackendConfig, key: str, run_id: str) -> None:
        with anyio.CancelScope(shield=True):
            with anyio.move_on_after(5.0):
                try:
                    async with self._client(config, key) as client:
                        await client.post_json(f"/v1/runs/{run_id}/stop", {})
                except (HermesRemoteHTTPError, HermesRemoteProtocolError, httpx.RequestError):
                    return

    async def _stop_client(self, client: HermesRemoteClient, run_id: str) -> None:
        try:
            await client.post_json(f"/v1/runs/{run_id}/stop", {})
        except (HermesRemoteHTTPError, HermesRemoteProtocolError, httpx.RequestError):
            return

    @staticmethod
    def _http_error(status_code: int) -> str:
        return f"http_{status_code}"

    @staticmethod
    def _redact(text: str, secret: str) -> str:
        return text.replace(secret, "[REDACTED]") if secret else text

    @classmethod
    def _redact_raw(cls, value: dict[str, Any], secret: str) -> dict[str, Any]:
        return {key: cls._redact_value(item, secret) for key, item in value.items()}

    @classmethod
    def _redact_value(cls, value: Any, secret: str) -> Any:
        if isinstance(value, str):
            return cls._redact(value, secret)
        if isinstance(value, dict):
            return {key: cls._redact_value(item, secret) for key, item in value.items()}
        if isinstance(value, list):
            return [cls._redact_value(item, secret) for item in value]
        return value


__all__ = ["CONSULT_ORIGIN_INSTRUCTION", "HermesRemoteBackend"]
