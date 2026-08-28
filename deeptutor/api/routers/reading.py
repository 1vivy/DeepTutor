"""Immersive reading API — materials, unit text, annotations, export.

A thin adapter over :mod:`deeptutor.reading`: it validates HTTP inputs, maps
engine errors to status codes, and streams bytes. No reading logic lives here,
so the router and the capability's tools cannot drift apart — both call the same
service functions.

Per-user isolation comes from the path service, exactly as for notebooks: the
store resolves ``<user workspace>/reading`` at call time, so a request already
scoped to a user by the auth dependency reaches only that user's materials.

The raw-file route returns a ``FileResponse``, which serves HTTP Range requests.
That matters: it is what lets pdf.js load a large PDF incrementally instead of
pulling the whole file before rendering page one.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
import shutil
import tempfile
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, UploadFile
from fastapi.params import File
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, model_validator

from deeptutor.reading import (
    ANNOTATION_COLORS,
    Annotation,
    MaterialNotFound,
    ReadingCatalogStore,
    ReadingError,
    ReadingPosition,
    ReadingStore,
    ReadingUpgradeConflict,
    export_material,
    render_outline,
)
from deeptutor.reading.ingestion import ReadingIngestionService
from deeptutor.reading.knowledge_capture import (
    organize_workspace_notes,
    send_workspace_to_notebook,
)
from deeptutor.reading.models import MAX_TEXT_SELECTOR_CHARS
from deeptutor.utils.document_validator import DocumentValidator

logger = logging.getLogger(__name__)

router = APIRouter()

# Streaming upload ceiling. Same number the extractor enforces, so a file that
# passes here cannot then be rejected deeper in with a less helpful message.
MAX_MATERIAL_BYTES = DocumentValidator.MAX_FILE_SIZE
_UPLOAD_CHUNK = 1024 * 1024
_MEDIA_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".mkv",
    ".webm",
    ".m4v",
    ".mp3",
    ".m4a",
    ".wav",
    ".aac",
    ".ogg",
    ".flac",
}


def _store() -> ReadingStore:
    return ReadingStore()


def _catalog() -> ReadingCatalogStore:
    return ReadingCatalogStore()


def _ingestion() -> ReadingIngestionService:
    catalog = _catalog()
    return ReadingIngestionService(ReadingStore(catalog.root), catalog)


def _http_error(exc: Exception) -> HTTPException:
    """Map an engine error to the status code that describes it.

    404 for "no such material", 400 for everything the caller can fix (bad
    locator, unsupported format, no extractable text). A 500 is reserved for
    failures that are genuinely ours.
    """
    if isinstance(exc, MaterialNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ReadingUpgradeConflict):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ReadingError):
        return HTTPException(status_code=400, detail=str(exc))
    logger.warning("unexpected reading error", exc_info=True)
    return HTTPException(status_code=500, detail="The reader could not complete that request.")


# === Models ===================================================================


class MaterialInfo(BaseModel):
    material_id: str
    filename: str
    unit: str
    unit_count: int
    mime: str = ""
    title: str = ""
    byte_size: int = 0
    char_count: int = 0
    created_at: float = 0.0
    has_raw_view: bool = False
    render_mode: Literal["text", "pdf", "epub", "video", "audio"] = "text"
    extractor: str = ""
    annotation_count: int = 0


class MaterialDetail(MaterialInfo):
    outline: list[dict[str, Any]] = Field(default_factory=list)
    outline_text: str = ""
    unit_refs: list[dict[str, Any]] = Field(default_factory=list)


class UnitText(BaseModel):
    locator: int
    unit: str
    text: str


class TextQuoteSelectorPayload(BaseModel):
    type: Literal["TextQuoteSelector"]
    exact: str = Field(min_length=1, max_length=2000)
    prefix: str = Field(default="", max_length=128)
    suffix: str = Field(default="", max_length=128)


class TextPositionSelectorPayload(BaseModel):
    type: Literal["TextPositionSelector"]
    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self) -> "TextPositionSelectorPayload":
        if self.end <= self.start:
            raise ValueError("selector end must be greater than start")
        if self.end - self.start > MAX_TEXT_SELECTOR_CHARS:
            raise ValueError(f"selector span must not exceed {MAX_TEXT_SELECTOR_CHARS} characters")
        return self


class AnnotationPayload(BaseModel):
    """An annotation as the reader sends it.

    ``rects`` are normalised to the unit box (0..1, origin top-left) by the
    client, because only the client knows the rendered geometry. They are still
    re-validated server-side — an inverted or out-of-range rectangle is ordered
    and clipped rather than trusted.
    """

    annotation_id: str = ""
    locator: int = Field(ge=1)
    kind: Literal["highlight", "underline", "note"] = "highlight"
    color: str = "yellow"
    quote: str = Field(default="", max_length=2000)
    note: str = ""
    rects: list[list[float]] = Field(default_factory=list)
    source_anchor: str = Field(default="", max_length=4096)
    selectors: list[TextQuoteSelectorPayload | TextPositionSelectorPayload] = Field(
        default_factory=list,
        max_length=2,
    )

    def to_annotation(self) -> Annotation:
        return Annotation.from_dict(
            {
                "annotation_id": self.annotation_id,
                "locator": self.locator,
                "kind": self.kind,
                "color": self.color if self.color in ANNOTATION_COLORS else "yellow",
                "quote": self.quote,
                "note": self.note,
                "rects": self.rects,
                "source_anchor": self.source_anchor,
                "selectors": [selector.model_dump() for selector in self.selectors],
                "author": "user",
            }
        )


class AnnotationInfo(BaseModel):
    annotation_id: str
    locator: int
    kind: str
    color: str
    quote: str
    note: str
    rects: list[list[float]]
    source_anchor: str = ""
    selectors: list[dict[str, Any]] = Field(default_factory=list)
    author: str
    created_at: float
    updated_at: float


class PositionPayload(BaseModel):
    locator: int = Field(ge=1)
    source_anchor: str = Field(default="", max_length=4096)
    percentage: float = Field(default=0.0, ge=0.0, le=1.0)


class PositionInfo(PositionPayload):
    updated_at: float = 0.0


class SupportedFormats(BaseModel):
    extensions: list[str]
    max_bytes: int
    raw_view_extensions: list[str]


class EpubPairingRequest(BaseModel):
    english_material_id: str
    chinese_material_id: str


class UrlImportRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=50)
    workspace_id: str = ""
    workspace_title: str = ""


class WorkspaceCreateRequest(BaseModel):
    title: str = Field(default="Untitled reading workspace", max_length=300)
    description: str = Field(default="", max_length=2000)
    material_ids: list[str] = Field(default_factory=list, max_length=100)


class WorkspaceUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=2000)


class WorkspaceMaterialRequest(BaseModel):
    material_id: str
    make_active: bool = False


class WorkspaceReorderRequest(BaseModel):
    material_ids: list[str] = Field(min_length=1, max_length=100)


class ReadingSessionCreateRequest(BaseModel):
    title: str = Field(default="New reading conversation", max_length=100)
    active_material_id: str = ""


class ReadingSessionRenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class ReadingSessionLinkRequest(BaseModel):
    target_session_id: str


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: str = ""


class TagCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="terracotta", max_length=64)


class OrganizeNotesRequest(BaseModel):
    material_ids: list[str] = Field(default_factory=list, max_length=100)


class NotebookCaptureRequest(OrganizeNotesRequest):
    notebook_ids: list[str] = Field(min_length=1, max_length=20)
    title: str = Field(default="", max_length=300)
    summary: str = Field(default="", max_length=1000)


# === Routes ===================================================================


@router.get("/library/materials")
async def list_library_materials(
    search: str = Query(default="", max_length=200),
    status: Literal["queued", "processing", "ready", "failed"] | None = None,
) -> dict[str, Any]:
    """Return reusable sources, lazily registering legacy material folders."""
    catalog = _catalog()
    try:
        for manifest in _store().list_materials():
            if catalog.get_material(manifest.material_id) is None:
                catalog.register_manifest(manifest)
        return {
            "materials": [row.to_dict() for row in catalog.list_materials(search=search, status=status)]
        }
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/library/import-urls", status_code=202)
async def import_urls(
    payload: UrlImportRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    """Queue safe webpage, YouTube, or Bilibili imports into a workspace."""
    service = _ingestion()
    try:
        materials = [service.queue_url(url) for url in payload.urls]
        workspace_id = payload.workspace_id.strip()
        if workspace_id:
            for material in materials:
                service.catalog.add_material(workspace_id, material.material_id)
            workspace = service.catalog.get_workspace(workspace_id)
        else:
            workspace = service.catalog.create_workspace(
                payload.workspace_title or "Imported reading",
                [row.material_id for row in materials],
            )
        for material in materials:
            background_tasks.add_task(service.process_url, material.material_id)
        return {
            "materials": [row.to_dict() for row in materials],
            "workspace": workspace.to_dict() if workspace else None,
        }
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/materials/{material_id}/retry", status_code=202)
async def retry_import(material_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
    service = _ingestion()
    try:
        material = service.catalog.get_material(material_id)
        if material is None:
            raise MaterialNotFound(f"material {material_id!r} not found")
        service.catalog.update_material_status(material_id, "queued", progress=0)
        background_tasks.add_task(service.retry, material_id)
        return {"material": service.catalog.get_material(material_id).to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/workspaces")
async def list_workspaces(
    search: str = Query(default="", max_length=200),
    folder_id: str = "",
    tag_id: str = "",
) -> dict[str, Any]:
    try:
        rows = _catalog().list_workspaces(
            search=search,
            folder_id=folder_id or None,
            tag_id=tag_id or None,
        )
        return {"workspaces": [row.to_dict() for row in rows]}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/workspaces", status_code=201)
async def create_workspace(payload: WorkspaceCreateRequest) -> dict[str, Any]:
    try:
        row = _catalog().create_workspace(
            payload.title,
            payload.material_ids,
            description=payload.description,
        )
        return {"workspace": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: str) -> dict[str, Any]:
    try:
        catalog = _catalog()
        row = catalog.get_workspace(workspace_id)
        if row is None:
            raise MaterialNotFound(f"reading workspace {workspace_id!r} not found")
        return {
            "workspace": row.to_dict(),
            "sessions": [session.to_dict() for session in catalog.list_sessions(workspace_id)],
        }
    except Exception as exc:
        raise _http_error(exc) from exc


@router.patch("/workspaces/{workspace_id}")
async def update_workspace(
    workspace_id: str, payload: WorkspaceUpdateRequest
) -> dict[str, Any]:
    try:
        row = _catalog().update_workspace(
            workspace_id,
            title=payload.title,
            description=payload.description,
        )
        return {"workspace": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str) -> dict[str, Any]:
    from deeptutor.services.session import get_session_store

    try:
        catalog = _catalog()
        sessions = catalog.list_sessions(workspace_id)
        if not catalog.delete_workspace(workspace_id):
            raise MaterialNotFound(f"reading workspace {workspace_id!r} not found")
        session_store = get_session_store()
        for session in sessions:
            await session_store.delete_session(session.session_id)
        return {"status": "ok", "workspace_id": workspace_id}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/workspaces/{workspace_id}/materials")
async def add_workspace_material(
    workspace_id: str, payload: WorkspaceMaterialRequest
) -> dict[str, Any]:
    try:
        row = _catalog().add_material(
            workspace_id, payload.material_id, make_active=payload.make_active
        )
        return {"workspace": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.put("/workspaces/{workspace_id}/materials/order")
async def reorder_workspace_materials(
    workspace_id: str, payload: WorkspaceReorderRequest
) -> dict[str, Any]:
    try:
        row = _catalog().reorder_materials(workspace_id, payload.material_ids)
        return {"workspace": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.put("/workspaces/{workspace_id}/materials/{material_id}/active")
async def activate_workspace_material(workspace_id: str, material_id: str) -> dict[str, Any]:
    try:
        row = _catalog().set_active_material(workspace_id, material_id)
        return {"workspace": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.delete("/workspaces/{workspace_id}/materials/{material_id}")
async def remove_workspace_material(workspace_id: str, material_id: str) -> dict[str, Any]:
    try:
        row = _catalog().remove_material(workspace_id, material_id)
        return {"workspace": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/folders")
async def list_folders() -> dict[str, Any]:
    return {"folders": [row.to_dict() for row in _catalog().list_folders()]}


@router.post("/folders", status_code=201)
async def create_folder(payload: FolderCreateRequest) -> dict[str, Any]:
    try:
        row = _catalog().create_folder(payload.name, parent_id=payload.parent_id or None)
        return {"folder": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.put("/workspaces/{workspace_id}/folders/{folder_id}")
async def assign_workspace_folder(workspace_id: str, folder_id: str) -> dict[str, Any]:
    try:
        catalog = _catalog()
        catalog.assign_workspace_folder(workspace_id, folder_id)
        return {"workspace": catalog.get_workspace(workspace_id).to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/tags")
async def list_tags() -> dict[str, Any]:
    return {"tags": [row.to_dict() for row in _catalog().list_tags()]}


@router.post("/tags", status_code=201)
async def create_tag(payload: TagCreateRequest) -> dict[str, Any]:
    try:
        row = _catalog().create_tag(payload.name, color=payload.color)
        return {"tag": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.put("/workspaces/{workspace_id}/tags/{tag_id}")
async def assign_workspace_tag(workspace_id: str, tag_id: str) -> dict[str, Any]:
    try:
        catalog = _catalog()
        catalog.assign_workspace_tag(workspace_id, tag_id)
        return {"workspace": catalog.get_workspace(workspace_id).to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/workspaces/{workspace_id}/sessions")
async def list_reading_sessions(workspace_id: str) -> dict[str, Any]:
    try:
        catalog = _catalog()
        return {
            "sessions": [
                row.to_dict()
                | {"linked_session_ids": catalog.list_session_links(workspace_id, row.session_id)}
                for row in catalog.list_sessions(workspace_id)
            ]
        }
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/workspaces/{workspace_id}/sessions", status_code=201)
async def create_reading_session(
    workspace_id: str, payload: ReadingSessionCreateRequest
) -> dict[str, Any]:
    from deeptutor.services.session import get_session_store

    catalog = _catalog()
    try:
        workspace = catalog.get_workspace(workspace_id)
        if workspace is None:
            raise MaterialNotFound(f"reading workspace {workspace_id!r} not found")
        active_material_id = payload.active_material_id or workspace.active_material_id
        if active_material_id and active_material_id not in {
            tab.material.material_id for tab in workspace.tabs
        }:
            raise ReadingError("active material does not belong to this reading workspace")
        session_store = get_session_store()
        session = await session_store.create_session(title=payload.title)
        await session_store.update_session_preferences(
            session["id"],
            {
                "capability": "immersive_reading",
                "session_kind": "immersive_reading",
                "reading_workspace_id": workspace_id,
                "reading_material_id": active_material_id or "",
            },
        )
        reading_session = catalog.attach_session(
            workspace_id,
            session["id"],
            title=payload.title,
            active_material_id=active_material_id,
        )
        return {"session": reading_session.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.patch("/workspaces/{workspace_id}/sessions/{session_id}")
async def rename_reading_session(
    workspace_id: str, session_id: str, payload: ReadingSessionRenameRequest
) -> dict[str, Any]:
    from deeptutor.services.session import get_session_store

    try:
        catalog = _catalog()
        row = catalog.rename_session(workspace_id, session_id, payload.title)
        await get_session_store().update_session_title(session_id, payload.title)
        return {"session": row.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.delete("/workspaces/{workspace_id}/sessions/{session_id}")
async def delete_reading_session(workspace_id: str, session_id: str) -> dict[str, Any]:
    from deeptutor.services.session import get_session_store

    try:
        catalog = _catalog()
        if not catalog.detach_session(workspace_id, session_id):
            raise MaterialNotFound("reading session not found")
        await get_session_store().delete_session(session_id)
        return {"status": "ok", "session_id": session_id}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/workspaces/{workspace_id}/sessions/{session_id}/links")
async def link_reading_session(
    workspace_id: str, session_id: str, payload: ReadingSessionLinkRequest
) -> dict[str, Any]:
    try:
        catalog = _catalog()
        catalog.link_session(workspace_id, session_id, payload.target_session_id)
        return {
            "session_id": session_id,
            "linked_session_ids": catalog.list_session_links(workspace_id, session_id),
        }
    except Exception as exc:
        raise _http_error(exc) from exc


@router.delete(
    "/workspaces/{workspace_id}/sessions/{session_id}/links/{target_session_id}"
)
async def unlink_reading_session(
    workspace_id: str, session_id: str, target_session_id: str
) -> dict[str, Any]:
    try:
        catalog = _catalog()
        catalog.unlink_session(workspace_id, session_id, target_session_id)
        return {
            "session_id": session_id,
            "linked_session_ids": catalog.list_session_links(workspace_id, session_id),
        }
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/workspaces/{workspace_id}/notes/organize")
async def organize_reading_notes(
    workspace_id: str, payload: OrganizeNotesRequest
) -> dict[str, Any]:
    try:
        catalog = _catalog()
        notes = await asyncio.to_thread(
            organize_workspace_notes,
            workspace_id,
            material_ids=payload.material_ids,
            catalog=catalog,
            reading_store=ReadingStore(catalog.root),
        )
        return {"notes": notes.to_dict()}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/workspaces/{workspace_id}/notebook")
async def capture_reading_to_notebook(
    workspace_id: str, payload: NotebookCaptureRequest
) -> dict[str, Any]:
    try:
        catalog = _catalog()
        result = await asyncio.to_thread(
            send_workspace_to_notebook,
            workspace_id,
            payload.notebook_ids,
            material_ids=payload.material_ids,
            title=payload.title,
            summary=payload.summary,
            catalog=catalog,
            reading_store=ReadingStore(catalog.root),
        )
        return {"success": True, **result}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/supported-formats", response_model=SupportedFormats)
async def supported_formats() -> SupportedFormats:
    """What the reader accepts — the single source of truth for the file picker."""
    from deeptutor.reading.extract import RAW_VIEW_EXTENSIONS
    from deeptutor.utils.document_extractor import SUPPORTED_DOC_EXTENSIONS

    return SupportedFormats(
        extensions=sorted(set(SUPPORTED_DOC_EXTENSIONS) | _MEDIA_EXTENSIONS),
        max_bytes=MAX_MATERIAL_BYTES,
        raw_view_extensions=sorted(set(RAW_VIEW_EXTENSIONS) | _MEDIA_EXTENSIONS),
    )


@router.get("/materials", response_model=list[MaterialInfo])
async def list_materials() -> list[MaterialInfo]:
    store = _store()
    try:
        return [_info(store, manifest) for manifest in store.list_materials()]
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/materials", response_model=MaterialDetail)
async def upload_material(file: UploadFile = File(...)) -> MaterialDetail:  # noqa: B008
    """Ingest an uploaded document and return it ready to read.

    The upload is streamed to a temp file with a running size check, so an
    oversized file is rejected before it is fully buffered rather than after.
    """
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="The upload has no filename.")

    tmp_dir = Path(tempfile.mkdtemp(prefix="dt-reading-"))
    tmp_path = tmp_dir / Path(filename).name
    written = 0
    try:
        with tmp_path.open("wb") as sink:
            while chunk := await file.read(_UPLOAD_CHUNK):
                written += len(chunk)
                if written > MAX_MATERIAL_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"{filename} exceeds the "
                            f"{MAX_MATERIAL_BYTES // (1024 * 1024)} MB limit."
                        ),
                    )
                sink.write(chunk)
        if written == 0:
            raise HTTPException(status_code=400, detail=f"{filename} is empty.")

        store = _store()
        if Path(filename).suffix.lower() in _MEDIA_EXTENSIONS:
            record = await ReadingIngestionService(store, _catalog()).import_media(
                tmp_path, filename=filename
            )
            manifest = store.manifest(record.material_id)
        else:
            manifest = store.ingest(tmp_path, filename=filename)
            _catalog().register_manifest(manifest)
        return _detail(store, manifest)
    except HTTPException:
        raise
    except Exception as exc:
        raise _http_error(exc) from exc
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@router.get("/materials/{material_id}", response_model=MaterialDetail)
async def get_material(material_id: str) -> MaterialDetail:
    store = _store()
    try:
        return _detail(store, store.manifest(material_id))
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/materials/{material_id}/epub-pairing-candidates")
async def epub_pairing_candidates(material_id: str) -> list[dict[str, Any]]:
    from deeptutor.reading.epub_bilingual import recommend_epub_candidates

    try:
        return await asyncio.to_thread(recommend_epub_candidates, _store(), material_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/epub-pairings")
async def epub_pairings() -> list[dict[str, Any]]:
    from deeptutor.reading.epub_bilingual import list_epub_pairings

    return list_epub_pairings(_store())


@router.post("/epub-pairings")
async def create_epub_pairing(payload: EpubPairingRequest) -> dict[str, Any]:
    from deeptutor.reading.epub_bilingual import create_epub_pairing

    try:
        pairing = await asyncio.to_thread(
            create_epub_pairing,
            _store(),
            payload.english_material_id,
            payload.chinese_material_id,
        )
        return {"pairing": pairing}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.delete("/epub-pairings/{pairing_id}")
async def remove_epub_pairing(pairing_id: str) -> dict[str, Any]:
    from deeptutor.reading.epub_bilingual import delete_epub_pairing

    try:
        removed = await asyncio.to_thread(delete_epub_pairing, _store(), pairing_id)
    except Exception as exc:
        raise _http_error(exc) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="EPUB pairing not found")
    return {"status": "ok", "pairing_id": pairing_id}


@router.delete("/materials/{material_id}")
async def delete_material(material_id: str) -> dict[str, Any]:
    store = _store()
    try:
        removed = store.delete(material_id)
    except Exception as exc:
        raise _http_error(exc) from exc
    if not removed:
        raise HTTPException(status_code=404, detail=f"material {material_id!r} not found")
    _catalog().delete_material(material_id)
    return {"status": "ok", "material_id": material_id}


@router.get("/materials/{material_id}/units/{locator}", response_model=UnitText)
async def get_unit(material_id: str, locator: int) -> UnitText:
    """One unit's text — the reader's text view, and the only view for non-PDFs."""
    store = _store()
    try:
        manifest = store.manifest(material_id)
        return UnitText(
            locator=locator,
            unit=manifest.unit,
            text=store.unit_text(material_id, locator),
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/materials/{material_id}/raw")
async def get_raw(material_id: str) -> FileResponse:
    """The original bytes, for the faithful viewer. Serves Range requests."""
    store = _store()
    try:
        manifest = store.manifest(material_id)
        path = store.raw_path(material_id)
    except Exception as exc:
        raise _http_error(exc) from exc
    if path is None or not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"{manifest.filename} has no stored original to render.",
        )
    return FileResponse(
        path,
        media_type=manifest.mime or "application/octet-stream",
        filename=manifest.filename,
        content_disposition_type="inline",
    )


@router.get("/materials/{material_id}/annotations", response_model=list[AnnotationInfo])
async def list_annotations(material_id: str) -> list[AnnotationInfo]:
    store = _store()
    try:
        return [_annotation_info(row) for row in store.annotations(material_id)]
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/materials/{material_id}/position", response_model=PositionInfo)
async def get_position(material_id: str) -> PositionInfo:
    """Return the user's last durable viewport for this material."""
    store = _store()
    try:
        return PositionInfo(**store.position(material_id).to_dict())
    except Exception as exc:
        raise _http_error(exc) from exc


@router.put("/materials/{material_id}/position", response_model=PositionInfo)
async def save_position(material_id: str, payload: PositionPayload) -> PositionInfo:
    """Persist a validated numeric locator plus an optional renderer anchor."""
    store = _store()
    try:
        saved = store.save_position(
            material_id,
            ReadingPosition(
                locator=payload.locator,
                source_anchor=payload.source_anchor,
                percentage=payload.percentage,
            ),
        )
        return PositionInfo(**saved.to_dict())
    except Exception as exc:
        raise _http_error(exc) from exc


@router.put("/materials/{material_id}/annotations", response_model=AnnotationInfo)
async def save_annotation(material_id: str, payload: AnnotationPayload) -> AnnotationInfo:
    """Create or update one annotation (id absent = create)."""
    store = _store()
    try:
        saved = store.save_annotation(material_id, payload.to_annotation())
    except Exception as exc:
        raise _http_error(exc) from exc
    return _annotation_info(saved)


@router.delete("/materials/{material_id}/annotations/{annotation_id}")
async def delete_annotation(material_id: str, annotation_id: str) -> dict[str, Any]:
    store = _store()
    try:
        removed = store.delete_annotation(material_id, annotation_id)
    except Exception as exc:
        raise _http_error(exc) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="annotation not found")
    return {"status": "ok", "annotation_id": annotation_id}


@router.get("/materials/{material_id}/export")
async def export(
    material_id: str,
    fmt: Literal["auto", "pdf", "markdown"] = Query("auto"),
) -> Response:
    """Download the material with its annotations applied.

    ``pdf`` writes real PDF annotations into a copy of the original, so the
    export keeps working outside DeepTutor; ``markdown`` returns the marks as
    text, which is what every non-PDF format gets.
    """
    store = _store()
    try:
        result = export_material(store, material_id, fmt=fmt)
    except Exception as exc:
        raise _http_error(exc) from exc
    return Response(
        content=result.data,
        media_type=result.media_type,
        headers={
            "Content-Disposition": _attachment_header(result.filename),
            "Content-Length": str(result.byte_size),
        },
    )


# === Helpers ==================================================================


def _info(store: ReadingStore, manifest: Any) -> MaterialInfo:
    return MaterialInfo(
        **manifest.to_dict() | {"annotation_count": len(store.annotations(manifest.material_id))}
    )


def _detail(store: ReadingStore, manifest: Any) -> MaterialDetail:
    outline = store.outline(manifest.material_id)
    return MaterialDetail(
        **manifest.to_dict()
        | {
            "annotation_count": len(store.annotations(manifest.material_id)),
            "outline": [entry.to_dict() for entry in outline],
            "outline_text": render_outline(store, manifest.material_id),
            "unit_refs": [entry.to_dict() for entry in store.unit_references(manifest.material_id)],
        }
    )


def _annotation_info(row: Annotation) -> AnnotationInfo:
    return AnnotationInfo(**row.to_dict())


def _attachment_header(filename: str) -> str:
    """RFC 5987 disposition so non-ASCII names survive the round trip."""
    from urllib.parse import quote

    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "export"
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}"


__all__ = ["MAX_MATERIAL_BYTES", "router"]
