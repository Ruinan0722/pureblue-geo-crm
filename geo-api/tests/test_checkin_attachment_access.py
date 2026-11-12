"""打卡附件访问控制。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.modules.auth.schemas import AuthUser
from app.modules.checkin.service import CheckinService


def _user(*, user_id: str = "u-a", scope: str = "own", perms: list[str] | None = None) -> AuthUser:
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name="A",
        role="sales",
        permissions=perms or ["section:checkin", "checkin:view_team"],
        data_scope=scope,
        department_names=["销售部"],
    )


@pytest.mark.asyncio
async def test_checkin_attachment_missing_is_not_found(monkeypatch, tmp_path: Path):
    svc = CheckinService(AsyncMock())
    missing = tmp_path / "nope.jpg"
    monkeypatch.setattr(
        "app.modules.checkin.service.resolve_attachment_path",
        lambda _aid: missing,
    )
    with pytest.raises(NotFoundError):
        await svc.assert_attachment_access(_user(), "nope.jpg")


@pytest.mark.asyncio
async def test_checkin_attachment_owner_can_read(monkeypatch, tmp_path: Path):
    svc = CheckinService(AsyncMock())
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        "app.modules.checkin.service.resolve_attachment_path",
        lambda _aid: f,
    )
    svc.repo.find_user_id_for_attachment = AsyncMock(return_value="u-a")
    await svc.assert_attachment_access(_user(user_id="u-a"), "a.jpg")


@pytest.mark.asyncio
async def test_checkin_attachment_denies_out_of_scope(monkeypatch, tmp_path: Path):
    svc = CheckinService(AsyncMock())
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    monkeypatch.setattr(
        "app.modules.checkin.service.resolve_attachment_path",
        lambda _aid: f,
    )
    svc.repo.find_user_id_for_attachment = AsyncMock(return_value="u-b")

    async def fake_allowed(_user, scope):
        del scope
        return ["u-a"]

    monkeypatch.setattr(svc, "_allowed_user_ids", fake_allowed)
    with pytest.raises(PermissionDeniedError):
        await svc.assert_attachment_access(_user(user_id="u-a", scope="department"), "a.jpg")
