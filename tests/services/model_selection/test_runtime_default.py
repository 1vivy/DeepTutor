"""Default model changes take effect at turn boundaries in existing workers."""

from unittest.mock import Mock

from deeptutor.services.config.provider_runtime import ResolvedLLMConfig
from deeptutor.services.llm import config as llm_config
from deeptutor.services.model_selection import runtime


def test_new_turn_uses_saved_default_instead_of_worker_cache(monkeypatch):
    """A warmed worker observes catalog changes without a process restart."""
    old = llm_config.LLMConfig(model="old-model", api_key="")
    monkeypatch.setattr(llm_config, "_LLM_CONFIG_CACHE", old)
    resolved = ResolvedLLMConfig(
        model="new-model", provider_name="openrouter", provider_mode="standard"
    )
    resolver = Mock(return_value=resolved)
    monkeypatch.setattr(runtime, "resolve_llm_runtime_config", resolver)
    config, token = runtime.activate_llm_selection(None)
    try:
        assert config.model == "new-model"
        assert llm_config.get_llm_config() is config
        resolver.assert_called_once_with(llm_selection=None)
        # Changing the catalog during a turn must not change its scoped model.
        resolved.model = "next-model"
        assert llm_config.get_llm_config().model == "new-model"
    finally:
        runtime.reset_llm_selection(token)
    config, token = runtime.activate_llm_selection(None)
    try:
        assert config.model == "next-model"
    finally:
        runtime.reset_llm_selection(token)


def test_explicit_selection_survives_and_previous_scope_is_restored(monkeypatch):
    """Explicit session choices remain independent of the global default."""
    outer = llm_config.LLMConfig(model="outer", api_key="")
    outer_token = llm_config.set_scoped_llm_config(outer)
    selection = {"profile_id": "profile", "model_id": "chosen"}
    resolver = Mock(
        return_value=ResolvedLLMConfig(
            model="chosen", provider_name="openrouter", provider_mode="standard"
        )
    )
    monkeypatch.setattr(runtime, "resolve_llm_runtime_config", resolver)
    try:
        config, token = runtime.activate_llm_selection(selection)
        try:
            assert config.model == "chosen"
            resolver.assert_called_once_with(llm_selection=selection)
        finally:
            runtime.reset_llm_selection(token)
        assert llm_config.get_llm_config() is outer
    finally:
        llm_config.reset_scoped_llm_config(outer_token)
