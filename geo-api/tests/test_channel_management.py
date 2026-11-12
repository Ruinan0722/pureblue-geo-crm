from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.auth.schemas import AuthUser
from app.modules.channel_management.router import (
    PartnerBody,
    _require,
    _validate_partner,
    move_opportunity,
    sign_contract,
)


def _user(role: str = "admin", permissions: list[str] | None = None) -> AuthUser:
    return AuthUser(
        id="u1", feishu_open_id="ou1", name="渠道负责人", role=role,
        permissions=permissions or ["section:channels", "channels:create", "channels:write"],
        data_scope="all" if role == "admin" else "own",
    )


def test_channel_source_type_region_and_agent_options_are_validated():
    _validate_partner(PartnerBody(name="伙伴", channelType="广告代理", source="渠道伙伴", level="重点合作", region="华北区", city="北京", agencyTypes=["产品", "服务"]))
    with pytest.raises(HTTPException) as source_error:
        _validate_partner(PartnerBody(name="伙伴", source="不存在的来源"))
    assert "线索来源" in str(source_error.value.detail)
    with pytest.raises(HTTPException) as region_error:
        _validate_partner(PartnerBody(name="伙伴", region="华北区", city="上海"))
    assert "城市与所属区域不匹配" in str(region_error.value.detail)


def test_channel_management_requires_its_section_permission():
    with pytest.raises(HTTPException) as error:
        _require(_user(permissions=["section:customers"]), "channels:write")
    assert error.value.status_code == 403


class _FakeDb:
    def __init__(self, rows: dict[tuple[type, str], object]):
        self.rows = rows
        self.added: list[object] = []
        self.commits = 0

    async def get(self, model, row_id):
        return self.rows.get((model, row_id))

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        self.commits += 1


@pytest.mark.asyncio
async def test_legacy_stage_route_delegates_to_common_service(monkeypatch):
    from app.modules.channel_management import router as routes
    from app.models.channel import ChannelPartner
    from unittest.mock import AsyncMock
    partner=SimpleNamespace(id="p1", owner_user_id="u1")
    db=_FakeDb({(ChannelPartner,"p1"):partner})
    service=SimpleNamespace(get_opportunity=AsyncMock(return_value={"id":"o1","partnerId":"p1"}), update_opportunity=AsyncMock(return_value={"id":"o1","stage":"signing"}))
    monkeypatch.setattr(routes,"CrmService",lambda _:service)
    result=await move_opportunity("p1","o1",SimpleNamespace(stage="签署中",lost_reason=None),db,_user())
    service.update_opportunity.assert_awaited_once_with(_user(),"o1",{"stage":"signing","lostReason":None})
    assert result["stageCode"]=="signing"
