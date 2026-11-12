"""Compose 客户视图须带回子公司（子表）。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService


def _user() -> AuthUser:
    return AuthUser(
        id="u-admin",
        feishu_open_id="ou-a",
        name="管理员",
        role="admin",
        permissions=["section:customers", "customers:write", "customers:master_edit"],
        data_scope="all",
        roles=["admin"],
    )


@pytest.mark.asyncio
async def test_compose_async_includes_subsidiaries():
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="c1",
        company_name="Acme",
        status="connected",
        document={"companyName": "Acme"},
        owner_user_id="u1",
        migration_status=None,
    )
    svc.repo.list_coverage_children = AsyncMock(return_value={})
    svc.repo.list_customer_subsidiaries = AsyncMock(
        return_value=[
            {
                "id": "SUB-1",
                "name": "Acme 上海",
                "shortName": "上海",
                "creditCode": "",
                "city": "上海",
            }
        ]
    )
    view = await svc._compose_customer_view_async(_user(), row, [])
    assert view["subsidiaries"][0]["shortName"] == "上海"
