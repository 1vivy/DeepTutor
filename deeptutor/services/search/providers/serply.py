"""Serply search provider.

API: https://serply.io
Docs: https://serply.io/docs
Endpoints: https://api.serply.io/v1/{search,news,scholar}/

Serply serves live Google SERP rows plus the Google News and Google Scholar
verticals behind one key, so a study session can go from "what is X" to
"what do the papers say about X" without switching providers. Every mode
returns plain rows with no model-written answer, so consolidation still
supplies the answer.
"""

from __future__ import annotations

from datetime import datetime
import html
import re
from typing import Any

import requests

from ..base import BaseSearchProvider
from ..types import Citation, SearchResult, WebSearchResponse
from . import register_provider

# mode -> (URL path segment, key that holds the result rows)
_MODES: dict[str, tuple[str, str]] = {
    "search": ("search", "results"),
    "news": ("news", "entries"),
    "scholar": ("scholar", "articles"),
}
_TAG = re.compile(r"<[^>]+>")


@register_provider("serply")
class SerplyProvider(BaseSearchProvider):
    """Serply Google SERP / News / Scholar provider."""

    description = "Google SERP, News and Scholar results"
    BASE_URL = "https://api.serply.io/v1"
    API_KEY_ENV_VARS = ("SERPLY_API_KEY", "SEARCH_API_KEY")

    def search(
        self,
        query: str,
        mode: str = "search",
        max_results: int = 5,
        timeout: int = 30,
        **kwargs: Any,
    ) -> WebSearchResponse:
        """Search Serply.

        Args:
            query: Search query.
            mode: ``search`` (Google web), ``news`` (Google News) or ``scholar``
                (Google Scholar).
            max_results: Result cap. Serply's own ``num`` accepts 1-100; the
                news feed ignores it server-side, so rows are also cut here.
            timeout: Request timeout in seconds.
            **kwargs: Additional options, including ``base_url``, the API root
                (``/search/`` etc. is appended) for a self-hosted gateway.

        Returns:
            WebSearchResponse: Standardized search response.
        """
        if mode not in _MODES:
            raise ValueError(f"Serply mode must be one of {sorted(_MODES)}, got {mode!r}.")
        path, rows_key = _MODES[mode]
        root = str(kwargs.get("base_url") or self.BASE_URL).rstrip("/")
        num = max(1, min(int(max_results), 100))
        headers = {
            "X-Api-Key": self.api_key,
            "Accept": "application/json",
            "User-Agent": "deeptutor",
        }
        request_kwargs: dict[str, Any] = {"headers": headers, "params": {"q": query, "num": num}}
        if self.proxy:
            request_kwargs["proxies"] = {"http": self.proxy, "https": self.proxy}
        resp = requests.get(f"{root}/{path}/", timeout=timeout, **request_kwargs)
        if resp.status_code != 200:
            raise Exception(f"Serply API error: {resp.status_code} - {resp.text}")
        payload = resp.json()
        rows = (payload.get(rows_key) or [])[:num]

        citations: list[Citation] = []
        search_results: list[SearchResult] = []
        for idx, row in enumerate(rows, 1):
            result = _parse_row(mode, row)
            search_results.append(result)
            citations.append(
                Citation(
                    id=idx,
                    reference=f"[{idx}]",
                    url=result.url,
                    title=result.title,
                    snippet=result.snippet,
                    date=result.date,
                    source=result.source,
                )
            )

        metadata: dict[str, Any] = {"finish_reason": "stop", "mode": mode}
        if payload.get("related_searches"):
            metadata["relatedSearches"] = payload["related_searches"]
        if payload.get("knowledge_graph"):
            metadata["knowledgeGraph"] = payload["knowledge_graph"]

        return WebSearchResponse(
            query=query,
            answer="",
            provider="serply_scholar" if mode == "scholar" else "serply",
            timestamp=datetime.now().isoformat(),
            model=f"serply-{mode}",
            citations=citations,
            search_results=search_results,
            metadata=metadata,
        )


def _parse_row(mode: str, row: dict[str, Any]) -> SearchResult:
    """Map one Serply row onto ``SearchResult``; each vertical has its own shape."""
    title = str(row.get("title", ""))
    url = str(row.get("link", ""))
    if mode == "news":
        source = (row.get("source") or {}).get("title") or "Google News"
        return SearchResult(
            title=title,
            url=url,
            snippet=html.unescape(_TAG.sub("", str(row.get("summary", "") or ""))).strip(),
            date=str(row.get("published", "") or ""),
            source=str(source),
        )
    if mode == "scholar":
        # Keyed like Serper's scholar rows so the shared academic template renders them.
        attributes: dict[str, Any] = {}
        if (row.get("author") or {}).get("names"):
            attributes["publicationInfo"] = row["author"]["names"]
        cited = ((row.get("extras") or {}).get("citations") or {}).get("count")
        if cited is not None:
            attributes["citedBy"] = cited
        if (row.get("doc") or {}).get("link"):
            attributes["pdfUrl"] = row["doc"]["link"]
        if row.get("id"):
            attributes["paperId"] = row["id"]
        return SearchResult(
            title=title,
            url=url,
            snippet=str(row.get("description", "") or ""),
            source="Google Scholar",
            attributes=attributes,
        )
    display_url = (row.get("metadata") or {}).get("display_url") or ""
    return SearchResult(
        title=title,
        url=url,
        snippet=str(row.get("description", "") or ""),
        source=str(display_url or "Serply"),
    )
