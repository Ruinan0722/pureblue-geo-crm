"""RBAC 部门子节点：返回飞书 children 映射。"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.rbac.service import RbacService


def _admin() -> AuthUser:
    return AuthUser(
        id="admin-1",
        feishu_open_id="ou-admin",
        name="管理员",
        role="admin",
        permissions=["section:settings", "settings:rbac"],
        data_scope="all",
    )


@pytest.mark.asyncio
async def test_list_department_children_maps_feishu_items(monkeypatch):
    svc = RbacService(AsyncMock())
    monkeypatch.setattr(svc, "_require_settings", lambda *_a, **_k: None)

    async def fake_token():
        return "tok"

    async def fake_children(parent_id, token):
        assert parent_id == "od-root"
        assert token == "tok"
        return [{"id": "od-a", "name": "销售一部"}, {"id": "od-b", "name": "销售二部"}]

    monkeypatch.setattr(
        "app.core.feishu.client.get_tenant_access_token", fake_token
    )
    monkeypatch.setattr(
        "app.core.feishu.contact.list_child_departments", fake_children
    )

    out = await svc.list_department_children(_admin(), "od-root")
    assert out == [
        {"id": "od-a", "name": "销售一部", "source": "feishu"},
        {"id": "od-b", "name": "销售二部", "source": "feishu"},
    ]


@pytest.mark.asyncio
async def test_list_department_children_requires_parent_id(monkeypatch):
    svc = RbacService(AsyncMock())
    monkeypatch.setattr(svc, "_require_settings", lambda *_a, **_k: None)
    with pytest.raises(ValidationError, match="parentId"):
        await svc.list_department_children(_admin(), "  ")
