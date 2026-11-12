"""RBAC 目录端点与开发身份登录契约：统一由 geo-api 提供。

前端不再直连 MySQL/Redis（原 /api/users/* 本地路由已删除，改走 /api/rbac/* 代理）。
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _app():
    return create_app()


@pytest.mark.asyncio
async def test_rbac_directory_endpoints_require_auth():
    transport = ASGITransport(app=_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for method, path in [
            ("GET", "/api/rbac/directory/departments?q=测试"),
            ("POST", "/api/rbac/directory/members"),
            ("GET", "/api/rbac/directory/meta"),
        ]:
            res = await client.request(
                method, path, json={"departmentId": "d1"} if method == "POST" else None
            )
            assert res.status_code == 401, f"{method} {path} 未鉴权应返回 401"


@pytest.mark.asyncio
async def test_auth_delete_me_clears_session_without_login():
    transport = ASGITransport(app=_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.delete("/api/auth/me")
        assert res.status_code == 200


@pytest.mark.asyncio
async def test_dev_login_blocked_when_flag_disabled(monkeypatch):
    from app.core import geo_features

    monkeypatch.setattr(geo_features, "is_feature_enabled", lambda _feature: False)
    transport = ASGITransport(app=_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/auth/me", json={"name": "测试", "role": "admin"})
        assert res.status_code == 403


def _scalars(rows):
    return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))


@pytest.mark.asyncio
async def test_find_real_user_prefers_ou_member():
    from app.modules.auth.service import AuthService

    db = AsyncMock()
    svc = AuthService(db)
    dev = SimpleNamespace(id="dev", name="演示成员02", feishu_open_id="dev_演示成员02", employment_status="active")
    real = SimpleNamespace(id="real", name="演示成员02", feishu_open_id="ou_xxx", employment_status="active")
    db.execute.return_value = _scalars([dev, real])

    found = await svc._find_real_user_by_name("演示成员02")
    assert found is not None
    assert found.id == "real"


@pytest.mark.asyncio
async def test_find_real_user_skips_dev_only():
    from app.modules.auth.service import AuthService

    db = AsyncMock()
    svc = AuthService(db)
    db.execute.return_value = _scalars(
        [SimpleNamespace(id="dev", name="超级测试", feishu_open_id="dev_超级测试", employment_status="active")]
    )
    assert await svc._find_real_user_by_name("超级测试") is None


@pytest.mark.asyncio
async def test_dev_login_impersonates_real_user():
    from app.modules.auth.service import AuthService

    db = AsyncMock()
    svc = AuthService(db)
    real = SimpleNamespace(id="real-1", role="sales")
    with (
        patch.object(svc, "_find_real_user_by_name", new=AsyncMock(return_value=real)),
        patch(
            "app.modules.auth.service.create_access_token",
            return_value=("token-abc", 7200),
        ) as tok,
    ):
        result = await svc.dev_login(name="演示成员06", role="sales")
    assert result == ("token-abc", 7200)
    tok.assert_called_once_with(user_id="real-1", role="sales")


@pytest.mark.asyncio
async def test_dev_placeholder_role_label_uses_rbac_role_name():
    """无 user_role_assignments 的 dev 占位身份，roleLabel 取 rbac_roles 名称而非裸角色 code。"""
    from app.models.user import User
    from app.modules.auth.repository import AuthRepository

    db = AsyncMock()

    def mapped_result(rows):
        m = SimpleNamespace(
            all=lambda: rows,
            first=lambda: (rows[0] if rows else None),
        )
        return SimpleNamespace(mappings=lambda: m)

    with patch(
        "app.modules.auth.repository.resolve_user_auth",
        new=AsyncMock(return_value=("ops", ["section:home", "section:notifications"], "all")),
    ):
        db.execute.side_effect = [
            mapped_result([]),                    # user_role_assignments 为空
            mapped_result([{"name": "销售运营"}]),  # rbac_roles 名称兜底
        ]
        repo = AuthRepository(db)
        user = User(
            id="u-dev-test",
            feishu_open_id="dev_运营测试",
            name="运营测试",
            role="ops",
            role_source="dev",
            employment_status="active",
        )
        auth_user = await repo._to_auth_user(user)

    assert auth_user.role_label == "销售运营"
    assert auth_user.role == "ops"
