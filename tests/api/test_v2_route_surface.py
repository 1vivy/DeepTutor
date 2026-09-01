from types import SimpleNamespace

import pytest

from deeptutor.api.main import app, health_live, health_ready


def test_legacy_chat_routes_are_removed() -> None:
    paths = {route.path for route in app.routes}
    assert "/api/v1/chat" not in paths
    assert "/api/v1/chat/sessions" not in paths
    assert not any(path.startswith("/api/v1/chat/sessions/") for path in paths)
    assert "/api/v1/ws" in paths
    assert "/api/v1/sessions" in paths
    assert "/api/v1/system/runtime" in paths


class _Coordinator:
    def __init__(self, healthy: bool) -> None:
        self.healthy = healthy

    async def health(self) -> bool:
        return self.healthy


@pytest.mark.asyncio
async def test_health_endpoints_distinguish_liveness_and_readiness() -> None:
    assert await health_live() == {"status": "alive"}
    state = SimpleNamespace(ready=False)
    request = SimpleNamespace(app=SimpleNamespace(state=state))

    not_started = await health_ready(request)
    assert not_started.status_code == 503

    state.ready = True
    state.application_container = SimpleNamespace(coordinator=_Coordinator(False))
    unavailable = await health_ready(request)
    assert unavailable.status_code == 503

    state.application_container.coordinator = _Coordinator(True)
    assert await health_ready(request) == {"status": "ready"}
