from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _client(mu_isolated_root, monkeypatch) -> tuple[TestClient, dict]:
    from deeptutor.api.routers import auth as auth_router
    from deeptutor.book import engine as engine_module
    from deeptutor.book import storage as storage_module
    from deeptutor.book.models import Book
    from deeptutor.book.storage import BookStorage
    from deeptutor.multi_user import router as multi_user_router
    from deeptutor.multi_user.identity import save_user
    from deeptutor.multi_user.paths import get_admin_path_service
    from deeptutor.services.auth import TokenPayload, hash_password

    root = save_user("root", hash_password("root-password"), role="admin")
    guardian = save_user("guardian", hash_password("guardian-password"))
    learner = save_user("learner", hash_password("learner-password"), preset="learner")
    stranger = save_user("stranger", hash_password("stranger-password"))
    tokens = {
        "root-token": TokenPayload(username="root", role="admin", user_id=root["id"]),
        "guardian-token": TokenPayload(username="guardian", role="user", user_id=guardian["id"]),
        "learner-token": TokenPayload(username="learner", role="user", user_id=learner["id"]),
        "stranger-token": TokenPayload(username="stranger", role="user", user_id=stranger["id"]),
    }
    monkeypatch.setattr(auth_router, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth_router, "decode_token", lambda token: tokens.get(token))
    monkeypatch.setattr(multi_user_router, "POCKETBASE_ENABLED", False)

    storage_module._storages.clear()
    engine_module._engines.clear()
    BookStorage(path_service=get_admin_path_service()).save_book(
        Book(id="bk_approved", title="Approved")
    )
    BookStorage(path_service=get_admin_path_service()).save_book(
        Book(id="bk_private", title="Private")
    )

    app = FastAPI()
    app.include_router(multi_user_router.router, prefix="/api/v1/multi-user")
    return TestClient(app), {
        "root": root,
        "guardian": guardian,
        "learner": learner,
    }


def test_admin_can_authorize_and_revoke_guardians(mu_isolated_root, monkeypatch):
    client, users = _client(mu_isolated_root, monkeypatch)
    guardian_id = users["guardian"]["id"]
    learner_id = users["learner"]["id"]

    self_relation = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": guardian_id,
            "learner_user_id": guardian_id,
            "permissions": ["view_reports"],
        },
    )
    assert self_relation.status_code == 400

    admin_target = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": users["root"]["id"],
            "learner_user_id": learner_id,
            "permissions": ["view_reports"],
        },
    )
    assert admin_target.status_code == 403

    non_learner_target = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": guardian_id,
            "learner_user_id": users["guardian"]["id"],
            "permissions": ["view_reports"],
        },
    )
    assert non_learner_target.status_code == 400
    assert "requires a learner account" in non_learner_target.json()["detail"]

    learner_as_guardian = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": learner_id,
            "learner_user_id": learner_id,
            "permissions": ["view_reports"],
        },
    )
    assert learner_as_guardian.status_code == 400
    assert "cannot be guardians" in learner_as_guardian.json()["detail"]

    created = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={"guardian_user_id": guardian_id, "learner_user_id": learner_id},
    )
    assert created.status_code == 201
    relationship = created.json()["relationship"]
    assert relationship["guardian_username"] == "guardian"
    assert relationship["learner_username"] == "learner"
    assert relationship["revoked_at"] is None

    duplicate = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={"guardian_user_id": guardian_id, "learner_user_id": learner_id},
    )
    assert duplicate.status_code == 409

    reverse = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={"guardian_user_id": learner_id, "learner_user_id": guardian_id},
    )
    assert reverse.status_code == 400

    mine = client.get("/api/v1/multi-user/me/guardianships", headers=_auth("guardian-token"))
    assert mine.status_code == 200
    assert mine.json()["relationships"][0]["id"] == relationship["id"]

    revoked = client.delete(
        f"/api/v1/multi-user/guardians/{relationship['id']}",
        headers=_auth("root-token"),
    )
    assert revoked.status_code == 200
    assert revoked.json()["relationship"]["revoked_at"] is not None
    assert (
        client.get("/api/v1/multi-user/me/guardianships", headers=_auth("guardian-token")).json()[
            "relationships"
        ]
        == []
    )
    assert (
        client.get(
            "/api/v1/multi-user/guardians",
            headers=_auth("root-token"),
        ).json()["relationships"]
        == []
    )
    history = client.get(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        params={"include_revoked": True},
    ).json()["relationships"]
    assert len(history) == 1


def test_guardian_report_requires_active_relationship_and_is_audited(mu_isolated_root, monkeypatch):
    client, users = _client(mu_isolated_root, monkeypatch)
    guardian_id = users["guardian"]["id"]
    learner_id = users["learner"]["id"]
    report_url = f"/api/v1/multi-user/learners/{learner_id}/guardian-report"

    assert client.get(report_url, headers=_auth("stranger-token")).status_code == 403
    assert client.get(report_url, headers=_auth("learner-token")).status_code == 403
    assert client.get(report_url, headers=_auth("guardian-token")).status_code == 403

    created = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": guardian_id,
            "learner_user_id": learner_id,
            "permissions": ["view_reports"],
        },
    )
    assert created.status_code == 201

    report = client.get(report_url, headers=_auth("guardian-token"))
    assert report.status_code == 200
    body = report.json()
    assert body["learner"]["username"] == "learner"
    assert body["assigned_materials"] == []
    assert body["book_permission"]["default"] == "none"

    audit_path = mu_isolated_root / "data" / "system" / "audit" / "usage.jsonl"
    events = [json.loads(line) for line in audit_path.read_text().splitlines()]
    report_event = next(event for event in events if event["action"] == "guardian_report_view")
    assert report_event["guardian_user_id"] == guardian_id
    assert report_event["learner_user_id"] == learner_id
    assert "learner-password" not in audit_path.read_text()


def test_guardian_can_assign_only_read_access_to_approved_books(mu_isolated_root, monkeypatch):
    client, users = _client(mu_isolated_root, monkeypatch)
    learner_id = users["learner"]["id"]
    created = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": users["guardian"]["id"],
            "learner_user_id": learner_id,
            "permissions": ["assign_materials", "view_reports"],
        },
    )
    assert created.status_code == 201

    materials_url = f"/api/v1/multi-user/learners/{learner_id}/materials"
    denied = client.put(materials_url, headers=_auth("stranger-token"), json={"book_ids": []})
    assert denied.status_code == 403
    unknown = client.put(
        materials_url,
        headers=_auth("guardian-token"),
        json={"book_ids": ["bk_missing"]},
    )
    assert unknown.status_code == 400
    assert unknown.json()["detail"] == "Unknown approved book id: bk_missing"

    assigned = client.put(
        materials_url,
        headers=_auth("guardian-token"),
        json={"book_ids": ["bk_private", "bk_approved"]},
    )
    assert assigned.status_code == 200
    permission = assigned.json()["book_permission"]
    assert permission["books"] == {"bk_private": "read", "bk_approved": "read"}
    assert permission["create"] is True
    assert permission["default"] == "none"

    report = client.get(
        f"/api/v1/multi-user/learners/{learner_id}/guardian-report",
        headers=_auth("guardian-token"),
    )
    assert report.status_code == 200
    assert {item["book_id"] for item in report.json()["assigned_materials"]} == {
        "bk_private",
        "bk_approved",
    }

    reset = client.post(
        f"/api/v1/multi-user/learners/{learner_id}/credentials/reset",
        headers=_auth("guardian-token"),
    )
    assert reset.status_code == 403


def test_guardian_can_reset_local_credentials_once_and_audit_hides_secret(
    mu_isolated_root, monkeypatch
):
    client, users = _client(mu_isolated_root, monkeypatch)
    learner_id = users["learner"]["id"]
    created = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": users["guardian"]["id"],
            "learner_user_id": learner_id,
            "permissions": ["reset_credentials"],
        },
    )
    assert created.status_code == 201

    from deeptutor.multi_user import router as multi_user_router
    from deeptutor.services.auth import verify_password

    monkeypatch.setattr(multi_user_router, "POCKETBASE_ENABLED", True)
    unsupported = client.post(
        f"/api/v1/multi-user/learners/{learner_id}/credentials/reset",
        headers=_auth("guardian-token"),
    )
    assert unsupported.status_code == 400
    monkeypatch.setattr(multi_user_router, "POCKETBASE_ENABLED", False)

    reset = client.post(
        f"/api/v1/multi-user/learners/{learner_id}/credentials/reset",
        headers=_auth("guardian-token"),
    )
    assert reset.status_code == 200
    temporary_password = reset.json()["temporary_password"]
    assert len(temporary_password) >= 16

    from deeptutor.multi_user.identity import load_users

    learner_hash = load_users()["learner"]["hash"]
    assert verify_password("learner-password", learner_hash) is False
    assert verify_password(temporary_password, learner_hash) is True

    audit_path = mu_isolated_root / "data" / "system" / "audit" / "usage.jsonl"
    assert temporary_password not in audit_path.read_text()


def test_user_deletion_revokes_related_guardian_records(mu_isolated_root, monkeypatch):
    client, users = _client(mu_isolated_root, monkeypatch)
    created = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": users["guardian"]["id"],
            "learner_user_id": users["learner"]["id"],
            "permissions": ["view_reports"],
        },
    )
    assert created.status_code == 201

    from deeptutor.multi_user.identity import delete_user

    assert delete_user("learner") is True
    history = client.get(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        params={"include_revoked": True},
    ).json()["relationships"]
    assert len(history) == 1
    assert history[0]["revoked_at"] is not None
    assert history[0]["revocation_reason"] == "user_deleted"


def test_guardian_access_rechecks_the_current_account_presets(mu_isolated_root, monkeypatch):
    client, users = _client(mu_isolated_root, monkeypatch)
    learner_id = users["learner"]["id"]
    created = client.post(
        "/api/v1/multi-user/guardians",
        headers=_auth("root-token"),
        json={
            "guardian_user_id": users["guardian"]["id"],
            "learner_user_id": learner_id,
            "permissions": ["view_reports"],
        },
    )
    assert created.status_code == 201

    from deeptutor.multi_user.identity import set_preset

    assert set_preset("learner", "standard") is True
    report = client.get(
        f"/api/v1/multi-user/learners/{learner_id}/guardian-report",
        headers=_auth("guardian-token"),
    )
    assert report.status_code == 403
