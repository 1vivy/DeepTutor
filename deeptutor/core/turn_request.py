"""Typed turn request value object shared by application and runtime layers."""

from __future__ import annotations

from typing import Any
import warnings

from pydantic import BaseModel, ConfigDict, Field, model_validator

_LEGACY_RUNTIME_CONFIG_KEYS: dict[str, str] = {
    "_persist_user_message": "persist_user_message",
    "_regenerate": "regenerate",
    "_regenerated_from_message_id": "regenerated_from_message_id",
    "_superseded_turn_id": "superseded_turn_id",
    "followup_question_context": "followup_question_context",
    "selection_tutor_context": "selection_tutor_context",
    "_course_id": "course_id",
    "subagent_consult_budget": "subagent_consult_budget",
    "auto_route": "auto_route",
}


class TurnRequest(BaseModel):
    """Validated turn input; ``config`` contains capability options only.

    The model keeps the historical keyword construction style. Runtime-only
    keys nested in ``config`` are translated for one major version so older
    clients continue to work while receiving a deprecation warning.
    """

    model_config = ConfigDict(extra="forbid")

    content: str
    capability: str | None = "chat"
    session_id: str | None = None
    tools: list[str] | None = None
    knowledge_bases: list[str] = Field(default_factory=list)
    language: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)

    notebook_references: list[dict[str, Any]] = Field(default_factory=list)
    history_references: list[str] = Field(default_factory=list)
    partner_group_references: list[dict[str, Any]] = Field(default_factory=list)
    question_notebook_references: list[int] = Field(default_factory=list)
    book_references: list[dict[str, Any]] = Field(default_factory=list)
    reading_references: list[dict[str, Any]] = Field(default_factory=list)
    memory_references: list[Any] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)

    persona: str | None = None
    llm_selection: dict[str, Any] | None = None
    workspace_mode: str | None = None
    mastery_path_id: str | None = None
    mastery_path_lease_managed: bool = False
    reading_material_id: str | None = None
    reading_material_revision: int | None = None
    reading_workspace_id: str | None = None
    reading_viewport: dict[str, Any] | None = None
    timed_media_id: str | None = None
    timed_media_viewport: dict[str, Any] | None = None
    parent_message_id: int | None = None

    # Runtime options are explicit and never passed to a capability schema.
    course_id: str | None = None
    persist_user_message: bool = True
    regenerate: bool = False
    regenerated_from_message_id: int | None = None
    superseded_turn_id: str | None = None
    followup_question_context: dict[str, Any] | None = None
    selection_tutor_context: dict[str, Any] | None = None
    subagent_consult_budget: int | None = Field(default=None, ge=0)
    auto_route: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def _translate_legacy_runtime_config(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        result = dict(value)
        config = result.get("config")
        if config is None or not isinstance(config, dict):
            return result
        public_config = dict(config)
        translated: list[str] = []
        for legacy_key, field_name in _LEGACY_RUNTIME_CONFIG_KEYS.items():
            if legacy_key not in public_config:
                continue
            legacy_value = public_config.pop(legacy_key)
            if field_name not in result:
                result[field_name] = legacy_value
            translated.append(legacy_key)
        result["config"] = public_config
        if translated:
            warnings.warn(
                "Runtime turn options in config are deprecated; use explicit TurnRequest "
                f"fields instead ({', '.join(sorted(translated))})",
                DeprecationWarning,
                stacklevel=3,
            )
        return result

    def to_payload(self) -> dict[str, Any]:
        """Return an execution payload while preserving omitted-field semantics."""

        return self.model_dump(mode="python", exclude_unset=True)


__all__ = ["TurnRequest"]
