"""Task models: pinned when asked for, inherited in every other case."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from deeptutor.services.config.model_catalog import ModelCatalogService
from deeptutor.services.model_selection.tasks import (
    TASK_SESSION_TITLE,
    TASK_STARTERS,
    resolve_task_selection,
)


def _catalog_with_tasks(service: ModelCatalogService, tasks: dict[str, Any]) -> dict[str, Any]:
    catalog = service.load()
    catalog["services"]["llm"]["profiles"] = [
        {
            "id": "llm-1",
            "name": "OpenRouter",
            "binding": "openrouter",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "sk-or",
            "models": [
                {"id": "model-big", "model": "anthropic/claude-opus-4"},
                {"id": "model-small", "model": "openai/gpt-5-mini"},
            ],
        }
    ]
    catalog["services"]["llm"]["tasks"] = tasks
    return catalog


def test_a_pinned_task_resolves_to_its_profile_and_model(tmp_path: Path) -> None:
    service = ModelCatalogService(path=tmp_path / "model_catalog.json")
    catalog = service.save(
        _catalog_with_tasks(
            service,
            {TASK_STARTERS: {"profile_id": "llm-1", "model_id": "model-small"}},
        )
    )

    selection = resolve_task_selection(TASK_STARTERS, catalog)

    assert selection is not None
    assert (selection.profile_id, selection.model_id) == ("llm-1", "model-small")


def test_an_unpinned_task_inherits(tmp_path: Path) -> None:
    service = ModelCatalogService(path=tmp_path / "model_catalog.json")
    catalog = service.save(_catalog_with_tasks(service, {}))

    assert resolve_task_selection(TASK_SESSION_TITLE, catalog) is None


def test_a_task_pointing_at_a_deleted_model_falls_back_to_inheriting(tmp_path: Path) -> None:
    service = ModelCatalogService(path=tmp_path / "model_catalog.json")
    catalog = service.save(
        _catalog_with_tasks(
            service,
            {TASK_SESSION_TITLE: {"profile_id": "llm-1", "model_id": "model-deleted"}},
        )
    )

    # Normalization drops the dangling pointer rather than leaving a task
    # aimed at a model that no longer exists.
    assert catalog["services"]["llm"]["tasks"] == {}
    assert resolve_task_selection(TASK_SESSION_TITLE, catalog) is None


def test_unknown_task_names_are_dropped(tmp_path: Path) -> None:
    service = ModelCatalogService(path=tmp_path / "model_catalog.json")
    catalog = service.save(
        _catalog_with_tasks(
            service,
            {"not_a_task": {"profile_id": "llm-1", "model_id": "model-big"}},
        )
    )

    assert catalog["services"]["llm"]["tasks"] == {}
    assert resolve_task_selection("not_a_task", catalog) is None
