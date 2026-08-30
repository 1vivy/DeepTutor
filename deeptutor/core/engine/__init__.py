"""Which loop drives a chat turn — DeepTutor's own, or a connected local CLI.

See ``protocol.py`` for the ``TurnEngine`` seam, ``registry.py`` for how a
turn's engine is chosen, ``deeptutor_engine.py`` for the (behavior-preserving)
default, and ``cli_engine.py`` + ``mcp_bridge.py`` for the external-CLI engine.
"""

from __future__ import annotations

from deeptutor.core.engine.protocol import (
    ENGINE_DEEPTUTOR,
    ENGINE_SELECTION_KEY,
    TurnEngine,
    TurnEngineFactory,
)
from deeptutor.core.engine.registry import (
    ENGINE_KIND_CODEX_CLI,
    EXTERNAL_ENGINE_KINDS,
    requested_engine_kind,
    resolve_engine,
)

__all__ = [
    "ENGINE_DEEPTUTOR",
    "ENGINE_SELECTION_KEY",
    "ENGINE_KIND_CODEX_CLI",
    "EXTERNAL_ENGINE_KINDS",
    "TurnEngine",
    "TurnEngineFactory",
    "requested_engine_kind",
    "resolve_engine",
]
