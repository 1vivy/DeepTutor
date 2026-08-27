"""Bounded mixed-source route generation for Mastery Topics."""

from __future__ import annotations

import json
from typing import Any

from deeptutor.learning import prompts as learning_prompts
from deeptutor.learning.models import (
    KnowledgePoint,
    KnowledgeType,
    LearningModule,
    TopicSource,
)
from deeptutor.services.llm import complete
from deeptutor.utils.json_parser import parse_json_response

_ALLOWED_TYPES = {item.value for item in KnowledgeType}
_MAX_SOURCES = 16
_MAX_SOURCE_EXCERPT = 4_000
_MAX_SOURCE_TOTAL = 24_000


class TopicGenerationError(RuntimeError):
    pass


def _source_payload(sources: list[TopicSource]) -> list[dict[str, Any]]:
    remaining = _MAX_SOURCE_TOTAL
    payload: list[dict[str, Any]] = []
    for source in sorted(sources, key=lambda item: item.position)[:_MAX_SOURCES]:
        excerpt = str(source.excerpt or "")[: min(_MAX_SOURCE_EXCERPT, remaining)]
        remaining -= len(excerpt)
        payload.append(
            {
                "kind": source.kind.value,
                "label": str(source.label or "")[:200],
                "excerpt": excerpt,
            }
        )
        if remaining <= 0:
            break
    return payload


def materialize_modules(path_id: str, raw_modules: list[dict[str, Any]]) -> list[LearningModule]:
    modules: list[LearningModule] = []
    for module_index, raw_module in enumerate(raw_modules[:8]):
        if not isinstance(raw_module, dict):
            continue
        module_name = str(raw_module.get("name") or "").strip()[:200]
        if not module_name:
            continue
        module_id = f"{path_id}_m{module_index}"
        knowledge_points: list[KnowledgePoint] = []
        raw_kps = raw_module.get("knowledge_points")
        if not isinstance(raw_kps, list):
            continue
        for kp_index, raw_kp in enumerate(raw_kps[:7]):
            if not isinstance(raw_kp, dict):
                continue
            name = str(raw_kp.get("name") or "").strip()[:200]
            if len(name) < 2:
                continue
            kp_type = str(raw_kp.get("type") or "concept").strip().lower()
            if kp_type not in _ALLOWED_TYPES:
                kp_type = "concept"
            knowledge_points.append(
                KnowledgePoint(
                    id=f"{module_id}_kp{kp_index}",
                    name=name,
                    type=KnowledgeType(kp_type),
                    module_id=module_id,
                )
            )
        if knowledge_points:
            modules.append(
                LearningModule(
                    id=module_id,
                    name=module_name,
                    order=len(modules),
                    pass_threshold=0.7,
                    knowledge_points=knowledge_points,
                )
            )
    if not modules:
        raise TopicGenerationError("The generated route contains no usable objectives")
    return modules


async def generate_topic_draft(
    *,
    name: str,
    goal: str,
    sources: list[TopicSource],
    language: str,
) -> dict[str, Any]:
    source_json = json.dumps(_source_payload(sources), ensure_ascii=False)
    system_prompt, prompt = learning_prompts.topic_generation_prompts(
        language,
        name=str(name or "").strip()[:120],
        goal=str(goal or "").strip()[:2_000],
        sources_json=source_json,
    )
    response = await complete(prompt=prompt, system_prompt=system_prompt)
    data = parse_json_response(response, fallback=None)
    if not isinstance(data, dict):
        raise TopicGenerationError("The model returned invalid route JSON")
    raw_modules = data.get("modules")
    if not isinstance(raw_modules, list):
        raise TopicGenerationError("The generated route has no module list")
    modules = materialize_modules("draft", raw_modules)
    return {
        "description": str(data.get("description") or "").strip()[:500],
        "modules": [module.model_dump(mode="json") for module in modules],
    }


__all__ = ["TopicGenerationError", "generate_topic_draft", "materialize_modules"]

