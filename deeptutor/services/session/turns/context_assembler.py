"""Context-builder boundary used by the turn executor."""

from __future__ import annotations

from typing import Any


class TurnContextAssembler:
    """Create the history/context assembler behind an injectable seam."""

    def _create_context_builder(self) -> Any:
        from deeptutor.services.session.context_builder import ContextBuilder

        return ContextBuilder(self.store)
