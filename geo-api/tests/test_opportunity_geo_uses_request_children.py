"""合同 GEO 使用商机持久化归属，忽略已退役的需求关系。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.crm.service import CrmService


@pytest.mark.asyncio
async def test_resolve_contract_geo_ignores_retired_request_children():
    opp = SimpleNamespace(
        id="opp-1",
        stage="contact",
        geo_source="manual",
        name=None,
        brand_name=None,
        region=None,
        goal=None,
        platform=None,
        period=None,
        owner=None,
        advisor=None,
        customer_success=None,
        subsidiary_id=None,
        subsidiary_name=None,
        primary_contact_id=None,
        lost_stage=None,
        lost_reason_l1=None,
        lost_reason_l2=None,
        competitor=None,
        amount=None,
        expected_sign_date=None,
        last_follow_at=None,
        next_follow_at=None,
        lost_reason=None,
        probability=None,
        created_day=None,
        document={"id": "opp-1", "stage": "contact", "geoSource": "manual"},
    )

    class Repo:
        async def get_opportunity(self, oid):
            return opp if oid == "opp-1" else None

        async def get_opportunity_children(self, oid):
            assert oid == "opp-1"
            return {
                "stageHistory": [],
                "attachments": [],
                "projectTypes": [],
                "requestIds": ["req-ov"],
                "notes": [],
                "advisorNotes": [],
            }

    svc = CrmService(AsyncMock())
    svc.repo = Repo()  # type: ignore[assignment]

    async def geo_map(_self, request_ids):
        assert request_ids == ["req-ov"]
        return {"req-ov": "overseas"}

    svc._geo_map_from_request_ids = geo_map.__get__(svc, CrmService)  # type: ignore[method-assign]

    geo = await svc._resolve_contract_geo({"id": "ct-1", "opportunityId": "opp-1"})
    assert geo == "manual"
