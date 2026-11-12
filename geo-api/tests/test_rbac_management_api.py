"""RBAC 管理接口：权限门槛、管理层级、单身份收敛、种子同步守卫。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.exceptions import PermissionDeniedError
from app.modules.auth.schemas import AuthUser
from app.modules.rbac import service as rbac_service_module
from app.modules.rbac.service import (
    AdminHierarchyError,
    RbacService,
    pick_highest_privilege,
    role_privilege_rank,
)


def _user(
    *,
    role: str = "admin",
    feishu_open_id: str = "ou-admin",
    permissions: list[str] | None = None,
) -> AuthUser:
    return AuthUser(
        id="u-admin",
        feishu_open_id=feishu_open_id,
        name="Admin",
        role=role,
        permissions=permissions or ["section:settings"],
        data_scope="all",
        department_names=[],
    )


def _svc(monkeypatch, *, designated: str = "ou-root"):
    db = AsyncMock()
    db.add = MagicMock()
    svc = RbacService(db)
    monkeypatch.setattr(
        svc, "_designated_super_admin_open_id", lambda: designated
    )
    return db, svc


def test_require_settings_blocks_non_settings_user():
    db = AsyncMock()
    db.add = MagicMock()
    svc = RbacService(db)
    with pytest.raises(PermissionDeniedError):
        svc._require_settings(_user(permissions=["section:customers"]))


def test_role_privilege_rank():
    assert role_privilege_rank("super_admin", "all", 0) == 100
    assert role_privilege_rank("admin", "all", 0) == 80
    custom = role_privilege_rank("custom_role", "department", 10)
    assert custom == 20 + 2 * 10 + 2


def test_pick_highest_privilege_keeps_first_on_tie():
    assert pick_highest_privilege(["viewer", "viewer"], lambda c: 20) == "viewer"
    assert pick_highest_privilege(["sales", "viewer"], lambda c: 40 if c == "sales" else 20) == "sales"


def test_admin_cannot_assign_admin_role():
    db = AsyncMock()
    db.add = MagicMock()
    svc = RbacService(db)
    svc._designated_super_admin_open_id = lambda: "ou-root"
    actor = _user(role="admin", feishu_open_id="ou-admin")
    with pytest.raises(AdminHierarchyError, match="仅超级管理员可设置管理员"):
        svc._assert_can_assign_roles(
            actor,
            {"feishuOpenId": "ou-target", "role": "viewer"},
            ["admin"],
            "admin",
        )


def test_super_admin_can_assign_admin_role(monkeypatch):
    _db, svc = _svc(monkeypatch, designated="ou-root")
    actor = _user(role="admin", feishu_open_id="ou-root")
    svc._assert_can_assign_roles(
        actor,
        {"feishuOpenId": "ou-target", "role": "viewer"},
        ["admin"],
        "admin",
    )


def test_cannot_mutate_designated_super_admin(monkeypatch):
    _db, svc = _svc(monkeypatch, designated="ou-root")
    with pytest.raises(AdminHierarchyError, match="不可修改超级管理员的权限"):
        svc._assert_can_mutate_target(
            _user(role="super_admin", feishu_open_id="ou-root"),
            {"feishuOpenId": "ou-root", "role": "super_admin"},
        )


def test_edit_role_template_requires_super_admin(monkeypatch):
    _db, svc = _svc(monkeypatch, designated="ou-root")
    with pytest.raises(AdminHierarchyError, match="仅超级管理员可修改"):
        svc._assert_can_edit_role_template(
            _user(role="admin", feishu_open_id="ou-admin"),
            "admin",
        )


@pytest.mark.asyncio
async def test_set_user_roles_picks_highest_and_invalidates(monkeypatch):
    db, svc = _svc(monkeypatch, designated="ou-root")
    target = SimpleNamespace(
        id="u-target",
        feishu_open_id="ou-target",
        role="viewer",
    )

    class _Result:
        def scalar_one_or_none(self):
            return target

    result = _Result()
    db.execute.return_value = result

    def fake_get_role_by_code(code):
        return AsyncMock(return_value=SimpleNamespace(id=f"role-{code}", code=code, data_scope="all"))() \
            if False else None

    roles = {
        "sales": SimpleNamespace(id="r-sales", code="sales", data_scope="own"),
        "viewer": SimpleNamespace(id="r-viewer", code="viewer", data_scope="own"),
        "admin": SimpleNamespace(id="r-admin", code="admin", data_scope="all"),
    }
    svc.repo.get_role_by_code = AsyncMock(side_effect=lambda code: roles.get(code))
    svc.repo.role_permissions = AsyncMock(return_value=["section:home"])
    svc.repo.set_user_single_role = AsyncMock()
    invalidated = AsyncMock()
    monkeypatch.setattr(
        rbac_service_module.cache_invalidation,
        "invalidate_after_user_rbac_change",
        invalidated,
    )

    await svc.set_user_roles(
        _user(role="super_admin", feishu_open_id="ou-root"),
        "u-target",
        ["viewer", "sales"],
        None,
    )
    # 单身份收敛：sales(40) > viewer(20)
    svc.repo.set_user_single_role.assert_awaited_once_with("u-target", "r-sales", "sales")
    invalidated.assert_awaited_once_with("u-target")


@pytest.mark.asyncio
async def test_set_user_overrides_rejects_invalid_permission(monkeypatch):
    db, svc = _svc(monkeypatch, designated="ou-root")
    target = SimpleNamespace(id="u-target", feishu_open_id="ou-target", role="viewer")

    class _Result:
        def scalar_one_or_none(self):
            return target

    result = _Result()
    db.execute.return_value = result
    svc.repo.valid_permission_codes = AsyncMock(return_value={"section:home"})

    from app.core.exceptions import ValidationError

    with pytest.raises(ValidationError, match="无效权限"):
        await svc.set_user_overrides(
            _user(role="super_admin", feishu_open_id="ou-root"),
            "u-target",
            [("not-a-permission", True)],
        )


@pytest.mark.asyncio
async def test_upsert_directory_profile_requires_settings(monkeypatch):
    _db, svc = _svc(monkeypatch, designated="ou-root")
    with pytest.raises(PermissionDeniedError):
        await svc.upsert_directory_profile(
            _user(permissions=["section:customers"]),
            feishu_open_id="ou-x",
            name="X",
            manual_department_open_id=None,
            manual_department_name=None,
            manual_department_note=None,
            manual_department_leader=False,
        )


@pytest.mark.asyncio
async def test_sync_member_profiles_creates_user(monkeypatch):
    db, svc = _svc(monkeypatch, designated="ou-root")

    class _NoResult:
        def scalar_one_or_none(self):
            return None

    db.execute.return_value = _NoResult()
    monkeypatch.setattr(
        rbac_service_module.cache_invalidation,
        "invalidate_after_org_sync",
        AsyncMock(),
    )

    updated = await svc.sync_member_profiles(
        [
            {
                "feishuOpenId": "ou-member",
                "name": "张三",
                "departmentOpenId": "od-1",
                "departmentName": "销售部",
                "breadcrumb": "公司>销售部",
                "leader": True,
            }
        ]
    )
    assert updated == 1
    added = [x for x in db.add.call_args_list]
    assert len(added) == 1
    user = added[0][0][0]
    assert user.feishu_open_id == "ou-member"
    assert user.manual_department_name == "公司>销售部"
    assert user.department_names == ["销售部"]
    assert user.role_source == "feishu"
