"""商机统一命名查重：同一客户下禁止重复创建同名（未输单）商机。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ConflictError
from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService


def _user() -> AuthUser:
    return AuthUser(
        id="u1",
        feishu_open_id="ou_u1",
        name="销售",
        role="sales",
        permissions=["section:opportunities", "opportunities:create"],
        data_scope="own",
    )


@pytest.mark.asyncio
async def test_create_opportunity_rejects_same_active_name(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    monkeypatch.setattr(svc, "_assert_section", lambda *a, **k: None)
    monkeypatch.setattr(svc, "_assert_opportunity_write", lambda *a, **k: None)
    monkeypatch.setattr(svc, "_stamp_opportunity_geo", AsyncMock(side_effect=lambda doc, user: doc))
    monkeypatch.setattr(
        svc.repo,
        "find_active_opportunity_by_customer_name",
        AsyncMock(return_value=SimpleNamespace(id="opp-existing", stage="contact")),
    )
    with pytest.raises(ConflictError):
        await svc.create_opportunity(
            _user(), {"customerId": "c1", "name": "同名商机", "requestIds": []}
        )


@pytest.mark.asyncio
async def test_create_opportunity_allows_when_existing_same_name_is_lost(monkeypatch):
    """同名商机已输单时不拦截：允许重新开商机（查重仅针对未输单）。"""
    db = AsyncMock()
    svc = CrmService(db)
    monkeypatch.setattr(svc, "_assert_section", lambda *a, **k: None)
    monkeypatch.setattr(svc, "_assert_opportunity_write", lambda *a, **k: None)
    monkeypatch.setattr(svc, "_stamp_opportunity_geo", AsyncMock(side_effect=lambda doc, user: doc))
    monkeypatch.setattr(
        svc.repo, "find_active_opportunity_by_customer_name", AsyncMock(return_value=None)
    )
    row = SimpleNamespace(id="opp-new", owner_user_id="u1", customer_id="c1")
    monkeypatch.setattr(svc.repo, "create_opportunity", AsyncMock(return_value=row))
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())
    monkeypatch.setattr(svc.repo, "get_opportunity", AsyncMock(return_value=row))
    monkeypatch.setattr(svc, "_compose_opportunity", AsyncMock(return_value={"id": "opp-new"}))

    result = await svc.create_opportunity(
        _user(), {"customerId": "c1", "name": "同名商机", "requestIds": []}
    )
    assert result["id"] == "opp-new"
