"""Stable reading-unit references for ordinary chat turns.

The browser sends only material_id plus numeric locators. Text, titles and
source labels are always re-resolved from the current user's ReadingStore at
turn start. This keeps a persisted chat reference small, prevents a client from
smuggling arbitrary text through a trusted source field, and makes deleted
materials fail closed.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from deeptutor.reading.store import MAX_READ_CHARS, ReadingStore

MAX_READING_REFERENCE_MATERIALS = 8
MAX_READING_REFERENCE_UNITS = 24
_MATERIAL_ID_RE = re.compile(r"^[0-9a-f]{8,64}$")


@dataclass(frozen=True, slots=True)
class ResolvedReadingSource:
    """One source-index row resolved from a stored reading unit."""

    source_id: str
    name: str
    full_text: str


def normalize_reading_references(value: Any) -> list[dict[str, Any]]:
    """Return a bounded, deduplicated wire representation.

    Malformed rows are ignored rather than partially trusted. Repeated rows for
    the same material are merged in first-seen order.
    """

    if not isinstance(value, list):
        return []

    by_material: dict[str, list[int]] = {}
    total = 0
    for raw in value:
        if not isinstance(raw, dict):
            continue
        material_id = str(raw.get("material_id") or "").strip().lower()
        if not _MATERIAL_ID_RE.fullmatch(material_id):
            continue
        locators = raw.get("locators")
        if not isinstance(locators, list):
            continue
        target = by_material.get(material_id)
        if target is None and len(by_material) >= MAX_READING_REFERENCE_MATERIALS:
            continue
        for candidate in locators:
            locator = _positive_integer(candidate)
            if locator is None or (target is not None and locator in target):
                continue
            if total >= MAX_READING_REFERENCE_UNITS:
                break
            if target is None:
                target = []
                by_material[material_id] = target
            target.append(locator)
            total += 1

    return [
        {"material_id": material_id, "locators": locators}
        for material_id, locators in by_material.items()
        if locators
    ]


def resolve_reading_sources(
    value: Any,
    *,
    store: ReadingStore | None = None,
) -> list[ResolvedReadingSource]:
    """Resolve canonical references against the active user's reading store."""

    active_store = store or ReadingStore()
    resolved: list[ResolvedReadingSource] = []
    for reference in normalize_reading_references(value):
        material_id = reference["material_id"]
        try:
            manifest = active_store.manifest(material_id)
            outline = active_store.outline(material_id)
            unit_refs = active_store.unit_references(material_id)
        except Exception:
            # Missing, deleted, or corrupt materials are not readable sources.
            continue

        headings: dict[int, str] = {}
        for row in outline:
            title = row.title.strip()
            if title:
                headings.setdefault(row.locator, title)
        native_titles = {row.locator: row.title.strip() for row in unit_refs if row.title.strip()}
        material_title = (manifest.title or manifest.filename or material_id).strip()

        for locator in reference["locators"]:
            if not 1 <= locator <= manifest.unit_count:
                continue
            try:
                body = active_store.unit_text(material_id, locator).strip()
            except Exception:
                continue
            if not body:
                continue
            heading = headings.get(locator) or native_titles.get(locator) or ""
            unit_label = f"{manifest.unit.capitalize()} {locator}"
            source_name = f"{material_title} — {unit_label}"
            if heading and heading.casefold() not in source_name.casefold():
                source_name += f": {heading}"
            if len(body) > MAX_READ_CHARS:
                body = (
                    body[:MAX_READ_CHARS].rstrip()
                    + f"\n… [reading unit truncated at {MAX_READ_CHARS:,} characters]"
                )
            header = (
                f"# Reading source: {material_title}\n"
                f"Source file: {manifest.filename}\n"
                f"{unit_label}{f': {heading}' if heading else ''}"
            )
            resolved.append(
                ResolvedReadingSource(
                    source_id=f"rd-{material_id}-{locator}",
                    name=source_name,
                    full_text=f"{header}\n\n{body}",
                )
            )
    return resolved


def _positive_integer(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None


__all__ = [
    "MAX_READING_REFERENCE_MATERIALS",
    "MAX_READING_REFERENCE_UNITS",
    "ResolvedReadingSource",
    "normalize_reading_references",
    "resolve_reading_sources",
]
