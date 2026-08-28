from __future__ import annotations

from pathlib import Path

import pytest

from deeptutor.reading.catalog_models import IngestionStatus, SourceKind
from deeptutor.reading.catalog_store import ReadingCatalogStore
from deeptutor.reading.ingestion import (
    MAX_TRANSCRIPT_BYTES,
    TRANSCRIPT_UNAVAILABLE_TEXT,
    BilibiliMedia,
    ReadingIngestionService,
    TranscriptSegment,
    build_transcript_segments,
    normalize_transcript_segments,
    parse_bilibili_url,
    parse_youtube_url,
)
from deeptutor.reading.models import ReadingError
from deeptutor.reading.store import ReadingStore
from deeptutor.tools.web_fetch import FetchOutcome


@pytest.fixture
def stores(tmp_path: Path):
    root = tmp_path / "reading"
    return ReadingStore(root), ReadingCatalogStore(root)


@pytest.mark.asyncio
async def test_web_import_uses_safe_fetch_result_and_builds_sections(stores) -> None:
    reading, catalog = stores

    async def fetcher(url: str, **_kwargs):
        return FetchOutcome(
            ok=True,
            url=url,
            title="A careful article",
            markdown="# A careful article\n\nFirst claim.\n\nSecond claim.",
        )

    service = ReadingIngestionService(reading, catalog, web_fetcher=fetcher)
    queued = service.queue_url("https://example.com/article")
    ready = await service.process_url(queued.material_id)

    assert queued.status is IngestionStatus.QUEUED
    assert ready.status is IngestionStatus.READY
    assert ready.source_kind is SourceKind.WEB
    manifest = reading.manifest(ready.material_id)
    assert manifest.title == "A careful article"
    assert "First claim" in reading.unit_text(ready.material_id, 1)


@pytest.mark.asyncio
async def test_failed_url_import_is_retryable(stores) -> None:
    _reading, catalog = stores

    async def fetcher(_url: str, **_kwargs):
        return FetchOutcome(ok=False, error="blocked by host policy")

    service = ReadingIngestionService(stores[0], catalog, web_fetcher=fetcher)
    queued = service.queue_url("https://example.com/private")
    failed = await service.process_url(queued.material_id)

    assert failed.status is IngestionStatus.FAILED
    assert failed.error_code == "web_fetch_failed"
    assert "blocked" in failed.error_detail


@pytest.mark.asyncio
async def test_youtube_import_prefers_timed_captions(stores) -> None:
    reading, catalog = stores

    async def youtube_loader(_url: str, _languages):
        return (
            "Retrieval Lecture",
            "https://i.ytimg.com/vi/abc123xyz00/hqdefault.jpg",
            [
                TranscriptSegment(0, 12, "Welcome to the lecture."),
                TranscriptSegment(12, 28, "We now define dense retrieval."),
            ],
        )

    service = ReadingIngestionService(reading, catalog, youtube_loader=youtube_loader)
    queued = service.queue_url("https://youtu.be/abc123xyz00")
    ready = await service.process_url(queued.material_id)

    assert ready.source_kind is SourceKind.YOUTUBE
    assert ready.render_mode == "video"
    assert ready.cover_url.endswith("hqdefault.jpg")
    assert reading.manifest(ready.material_id).unit == "segment"
    assert reading.manifest(ready.material_id).render_mode == "video"
    assert reading.unit_references(ready.material_id)[1].source_href == "#t=12"


@pytest.mark.parametrize(
    ("url", "video_id", "start"),
    [
        ("https://youtu.be/abc123xyz00?t=82", "abc123xyz00", 82),
        ("https://www.youtube.com/watch?v=abc123xyz00&t=1m2s&si=tracking", "abc123xyz00", 62),
        ("https://youtube.com/shorts/abc123xyz00", "abc123xyz00", 0),
        ("https://youtube.com/live/abc123xyz00?start=12", "abc123xyz00", 12),
        ("https://youtube.com/embed/abc123xyz00", "abc123xyz00", 0),
    ],
)
def test_youtube_url_shapes_are_canonical(url: str, video_id: str, start: int) -> None:
    parsed = parse_youtube_url(url)
    assert parsed.video_id == video_id
    assert parsed.entry_time_seconds == start
    assert "si=" not in parsed.canonical_url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "https://example.com/watch?v=abc123xyz00",
        "https://youtube.com/watch?v=../../etc",
        "https://youtube.com.evil.test/watch?v=abc123xyz00",
    ],
)
def test_invalid_youtube_urls_are_rejected(url: str) -> None:
    with pytest.raises(ReadingError):
        parse_youtube_url(url)


@pytest.mark.parametrize(
    ("url", "bvid", "page", "start"),
    [
        ("https://www.bilibili.com/video/BV1E7wtzaEdq/", "BV1E7wtzaEdq", 1, 0),
        ("https://m.bilibili.com/video/BV1E7wtzaEdq?p=2&t=82", "BV1E7wtzaEdq", 2, 82),
        ("https://player.bilibili.com/player.html?bvid=BV1E7wtzaEdq&p=3", "BV1E7wtzaEdq", 3, 0),
        ("https://b23.tv/BV1E7wtzaEdq", "BV1E7wtzaEdq", 1, 0),
    ],
)
def test_bilibili_url_shapes_are_canonical(
    url: str, bvid: str, page: int, start: int
) -> None:
    parsed = parse_bilibili_url(url)
    assert parsed.bvid == bvid
    assert parsed.page_number == page
    assert parsed.entry_time_seconds == start
    assert "spm_id_from=" not in parsed.canonical_url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "https://example.com/video/BV1E7wtzaEdq",
        "https://bilibili.com.evil.test/video/BV1E7wtzaEdq",
        "https://www.bilibili.com/video/not-a-bvid",
        "https://b23.tv/some-short-link",
    ],
)
def test_invalid_bilibili_urls_are_rejected(url: str) -> None:
    with pytest.raises(ReadingError):
        parse_bilibili_url(url)


@pytest.mark.asyncio
async def test_bilibili_import_uses_native_video_metadata_and_subtitles(stores) -> None:
    reading, catalog = stores

    async def bilibili_loader(_url: str, _languages):
        return BilibiliMedia(
            title="Agent Skill",
            cover_url="https://i0.hdslb.com/cover.jpg",
            duration_seconds=1951,
            page_number=1,
            cid=36694721904,
            segments=[TranscriptSegment(0, 31, "视频内容介绍")],
            chapters=[TranscriptSegment(0, 31, "视频内容介绍")],
        )

    service = ReadingIngestionService(
        reading, catalog, bilibili_loader=bilibili_loader
    )
    queued = service.queue_url(
        "https://www.bilibili.com/video/BV1E7wtzaEdq/?spm_id_from=tracking"
    )
    ready = await service.process_url(queued.material_id)

    assert queued.source_kind is SourceKind.BILIBILI
    assert ready.source_kind is SourceKind.BILIBILI
    assert ready.duration_seconds == 1951
    assert ready.cover_url.endswith("cover.jpg")
    assert reading.manifest(ready.material_id).extractor == "bilibili-subtitles"
    assert reading.unit_references(ready.material_id)[0].source_href == "#t=0"


@pytest.mark.asyncio
async def test_bilibili_chapters_remain_navigable_without_claiming_transcript(stores) -> None:
    reading, catalog = stores

    async def bilibili_loader(_url: str, _languages):
        return BilibiliMedia(
            title="Chaptered lecture",
            cover_url="",
            duration_seconds=120,
            page_number=1,
            cid=123,
            segments=[],
            chapters=[
                TranscriptSegment(0, 60, "LLM"),
                TranscriptSegment(60, 120, "Agent"),
            ],
        )

    service = ReadingIngestionService(
        reading, catalog, bilibili_loader=bilibili_loader
    )
    queued = service.queue_url("https://www.bilibili.com/video/BV1E7wtzaEdq")
    ready = await service.process_url(queued.material_id)

    manifest = reading.manifest(ready.material_id)
    assert manifest.extractor == "bilibili-chapters-only"
    assert reading.unit_references(ready.material_id)[1].source_href == "#t=60"
    assert "Chapter marker: Agent" in reading.unit_text(ready.material_id, 2)
    assert "Spoken transcript unavailable" in reading.unit_text(ready.material_id, 2)


def test_caption_flashes_become_stable_learning_segments() -> None:
    cues = [
        TranscriptSegment(0.0, 10.0, "One"),
        TranscriptSegment(10.0, 22.0, "sentence."),
        TranscriptSegment(22.0, 45.0, "Next concept."),
    ]
    segments = build_transcript_segments(cues)
    assert segments[0] == TranscriptSegment(0.0, 22.0, "One sentence.")
    assert segments[1].start_seconds == 22.0


def test_transcript_normalization_has_a_storage_budget(monkeypatch) -> None:
    monkeypatch.setattr("deeptutor.reading.ingestion.MAX_TRANSCRIPT_BYTES", 8)
    cues = normalize_transcript_segments(
        [
            {"start": 0, "duration": 1, "text": "1234"},
            {"start": 1, "duration": 1, "text": "5678"},
            {"start": 2, "duration": 1, "text": "overflow"},
        ]
    )
    assert MAX_TRANSCRIPT_BYTES > 8
    assert [cue.text for cue in cues] == ["1234", "5678"]


@pytest.mark.asyncio
async def test_missing_youtube_captions_does_not_block_native_playback(stores) -> None:
    reading, catalog = stores

    async def youtube_loader(_url: str, _languages):
        return "Visual lecture", "", []

    service = ReadingIngestionService(reading, catalog, youtube_loader=youtube_loader)
    queued = service.queue_url("https://youtube.com/live/abc123xyz00?start=12")
    ready = await service.process_url(queued.material_id)

    manifest = reading.manifest(ready.material_id)
    assert ready.status is IngestionStatus.READY
    assert manifest.extractor == "youtube-no-captions"
    assert reading.unit_text(ready.material_id, 1) == TRANSCRIPT_UNAVAILABLE_TEXT
    assert reading.unit_references(ready.material_id)[0].source_href == "#t=12"


@pytest.mark.asyncio
async def test_local_video_keeps_playable_raw_and_transcribes_chunks(
    stores, tmp_path: Path
) -> None:
    reading, catalog = stores
    source = tmp_path / "lecture.mp4"
    source.write_bytes(b"fake but stable video bytes")

    async def chunker(_path: Path):
        return [(0.0, 600.0, b"audio-one"), (600.0, 720.0, b"audio-two")]

    async def transcriber(audio: bytes, **_kwargs):
        return "first section" if audio == b"audio-one" else "second section"

    service = ReadingIngestionService(
        reading,
        catalog,
        media_chunker=chunker,
        transcriber=transcriber,
    )
    ready = await service.import_media(source, filename="lecture.mp4")

    assert ready.status is IngestionStatus.READY
    assert ready.source_kind is SourceKind.VIDEO
    assert reading.manifest(ready.material_id).render_mode == "video"
    assert reading.raw_path(ready.material_id).read_bytes() == source.read_bytes()
    assert reading.unit_text(ready.material_id, 2) == "second section"
