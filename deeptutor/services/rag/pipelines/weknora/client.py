"""Thin HTTP client for Tencent WeKnora's documented REST API."""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from .config import WeKnoraConfig

logger = logging.getLogger(__name__)


class WeKnoraAPIError(RuntimeError):
    """Raised when WeKnora returns an error or unexpected payload."""


class WeKnoraClient:
    def __init__(
        self,
        config: WeKnoraConfig,
        *,
        timeout: float = 60.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self._config = config
        self._timeout = timeout
        self._transport = transport

    def _open(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._config.base_url,
            headers={
                "Accept": "application/json",
                "X-API-Key": self._config.api_key,
            },
            timeout=self._timeout,
            transport=self._transport,
        )

    @staticmethod
    def _json(resp: httpx.Response) -> dict[str, Any]:
        if resp.status_code >= 400:
            raise WeKnoraAPIError(f"WeKnora returned {resp.status_code}: {resp.text[:300]}")
        try:
            data = resp.json()
        except Exception as exc:
            raise WeKnoraAPIError(f"WeKnora returned a non-JSON response: {exc}") from exc
        if not isinstance(data, dict):
            raise WeKnoraAPIError(f"WeKnora returned unexpected payload: {data!r}")
        return data

    async def list_knowledge_bases(self) -> list[dict[str, Any]]:
        async with self._open() as client:
            resp = await client.get("/api/v1/knowledge-bases")
        data = self._json(resp).get("data")
        if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
            raise WeKnoraAPIError("WeKnora returned an unexpected knowledge-base list.")
        return data

    async def search(self, query: str) -> list[dict[str, Any]]:
        async with self._open() as client:
            resp = await client.post(
                "/api/v1/knowledge-search",
                params={"resource_urls": "handle"},
                json={
                    "query": query,
                    "knowledge_base_id": self._config.knowledge_base_id,
                },
            )
        data = self._json(resp).get("data")
        if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
            raise WeKnoraAPIError("WeKnora returned unexpected search results.")
        return data


__all__ = ["WeKnoraAPIError", "WeKnoraClient"]
