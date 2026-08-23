"""Authenticated transport for schema-driven Immersive Reading extensions."""

from __future__ import annotations

import inspect
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deeptutor.reading import ReadingStore
from deeptutor.reading.extensions import (
    ReadingContext,
    ReadingExtensionResult,
    get_reading_extension_registry,
)

router = APIRouter()


class ActionPayload(BaseModel):
    locator: int = Field(ge=1)
    source_anchor: str = Field(default="", max_length=4096)
    selection: str = Field(default="", max_length=10_000)
    locale: str = Field(default="en", max_length=32)


def _normal(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _verified_selection(candidate: str, unit_text: str) -> str:
    value = _normal(candidate)
    return value if value and value in _normal(unit_text) else ""


@router.get("/extensions")
async def list_extensions() -> list[dict[str, Any]]:
    return [extension.manifest.model_dump() for extension in get_reading_extension_registry().all()]


@router.post("/materials/{material_id}/extensions/{extension_id}/actions/{action}")
async def run_extension_action(
    material_id: str,
    extension_id: str,
    action: str,
    payload: ActionPayload,
) -> dict[str, Any]:
    extension = get_reading_extension_registry().get(extension_id)
    if extension is None:
        raise HTTPException(status_code=404, detail="Reading extension not found.")
    declared_action = next((row for row in extension.manifest.actions if row.id == action), None)
    if declared_action is None:
        raise HTTPException(status_code=404, detail="Reading extension action not found.")
    try:
        unit_text = ReadingStore().unit_text(material_id, payload.locator)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    selection = _verified_selection(payload.selection, unit_text)
    if "selection" in declared_action.requires and not selection:
        raise HTTPException(status_code=400, detail="Select text from the visible unit first.")
    context = ReadingContext(
        material_id=material_id,
        locator=payload.locator,
        source_anchor=payload.source_anchor,
        locale=payload.locale,
        selection=selection,
        visible_text=unit_text,
    )
    try:
        value = extension.run_action(action, context)
        if inspect.isawaitable(value):
            value = await value
        result = (
            value
            if isinstance(value, ReadingExtensionResult)
            else ReadingExtensionResult.model_validate(value)
        )
        if result.type not in extension.manifest.result_types:
            raise ValueError(f"Extension returned undeclared result type {result.type!r}.")
        return result.model_dump()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "This reading action is temporarily unavailable.",
                "recoverable": True,
            },
        ) from exc


__all__ = ["router"]
