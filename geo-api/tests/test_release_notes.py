"""GET/PUT /api/release-notes — version changelog for geo-admin."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import get_db_session
from app.core.deps import require_user
from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.main import create_app
from app.modules.auth.schemas import AuthUser
from app.modules.release_notes.schemas import ReleaseNoteOut, UpsertReleaseNoteBody
from app.modules.release_notes.service import ReleaseNotesService


def _staff(*, role: str = "sales") -> AuthUser:
    return AuthUser(
        id="u1",
        feishu_open_id="ou_1",
        name="测试",
        avatar_url=None,
        role=role,
        permissions=[],
        data_scope="own",
        department_names=[],
    )


async def _fake_db() -> AsyncGenerator[Any, None]:
    yield None


def _override_auth(app, *, role: str = "sales") -> None:
    app.dependency_overrides[require_user] = lambda: _staff(role=role)
    app.dependency_overrides[get_db_session] = _fake_db


@pytest.mark.asyncio
async def test_get_release_note_found(monkeypatch: pytest.MonkeyPatch):
    async def fake_get(self: ReleaseNotesService, version: str) -> ReleaseNoteOut:
        assert version == "v1.2.0"
        return ReleaseNoteOut(
            version="v1.2.0",
            title="软刷新",
            body="- 更新说明\n- 草稿恢复",
            published_at="2026-07-27 10:00:00",
        )

    monkeypatch.setattr(ReleaseNotesService, "get_by_version", fake_get)

    app = create_app()
    app.dependency_overrides[get_db_session] = _fake_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/release-notes/v1.2.0")
    app.dependency_overrides.clear()

    assert res.status_code == 200
    body = res.json()
    assert body["version"] == "v1.2.0"
    assert body["title"] == "软刷新"
    assert "草稿恢复" in body["body"]


@pytest.mark.asyncio
async def test_get_release_note_404(monkeypatch: pytest.MonkeyPatch):
    async def fake_get(self: ReleaseNotesService, version: str) -> ReleaseNoteOut:
        raise NotFoundError("该版本暂无更新说明")

    monkeypatch.setattr(ReleaseNotesService, "get_by_version", fake_get)

    app = create_app()
    app.dependency_overrides[get_db_session] = _fake_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/release-notes/v-missing")
    app.dependency_overrides.clear()

    assert res.status_code == 404


@pytest.mark.asyncio
async def test_upsert_requires_admin(monkeypatch: pytest.MonkeyPatch):
    async def fake_upsert(
        self: ReleaseNotesService, user: AuthUser, body: UpsertReleaseNoteBody
    ) -> ReleaseNoteOut:
        if user.role not in {"admin", "super_admin"}:
            raise PermissionDeniedError("仅管理员可维护更新说明")
        return ReleaseNoteOut(
            version=body.version,
            title=body.title,
            body=body.body,
            published_at="2026-07-27 10:00:00",
        )

    monkeypatch.setattr(ReleaseNotesService, "upsert", fake_upsert)

    app = create_app()
    _override_auth(app, role="sales")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put(
            "/api/release-notes",
            json={"version": "v1.2.0", "title": "t", "body": "b"},
        )
    app.dependency_overrides.clear()

    assert res.status_code == 403


@pytest.mark.asyncio
async def test_upsert_admin_ok(monkeypatch: pytest.MonkeyPatch):
    async def fake_upsert(
        self: ReleaseNotesService, user: AuthUser, body: UpsertReleaseNoteBody
    ) -> ReleaseNoteOut:
        assert user.role == "admin"
        return ReleaseNoteOut(
            version=body.version,
            title=body.title,
            body=body.body,
            published_at="2026-07-27 12:00:00",
        )

    monkeypatch.setattr(ReleaseNotesService, "upsert", fake_upsert)

    app = create_app()
    _override_auth(app, role="admin")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put(
            "/api/release-notes",
            json={"version": "v-local-1", "title": "本地测试", "body": "第一条说明"},
        )
    app.dependency_overrides.clear()

    assert res.status_code == 200
    assert res.json()["version"] == "v-local-1"


@pytest.mark.asyncio
async def test_service_rejects_empty_version():
    class FakeRepo:
        async def get_by_version(self, version: str) -> Any:
            return None

    svc = ReleaseNotesService.__new__(ReleaseNotesService)
    svc.repo = FakeRepo()  # type: ignore[assignment]

    with pytest.raises(ValidationError):
        await svc.get_by_version("  ")
