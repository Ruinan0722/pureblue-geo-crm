"""客户主档/对接池剩余标量字段：列写穿 + 序列化切列（契约保持）。"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.crm.repository import CrmRepository
from app.modules.crm.service.helpers_customers import (
    _coverage_public_doc,
    _customer_master_columns,
)


def test_coverage_public_doc_uses_columns():
    row = SimpleNamespace(
        id="cv1",
        customer_id="c1",
        owner_user_id="u1",
        status="connected",
        owner_name=None,
        client_dept="市场部",
        source_lead_id="l1",
        sdr_name="SDR小张",
        sdr_transfer_date=date(2026, 5, 26),
        isolation_version=3,
        document={
            "ownerName": "销售A",
            "clientDept": "",
            "sourceLeadId": "",
            "sdrName": "",
            "sdrTransferDate": "",
            "isolationVersion": "",
        },
    )
    out = _coverage_public_doc(row, can_edit=True)
    assert out["clientDept"] == "市场部"
    assert out["sourceLeadId"] == "l1"
    assert out["sdrName"] == "SDR小张"
    assert out["sdrTransferDate"] == "2026-05-26"
    assert out["isolationVersion"] == 3
    assert out["ownerName"] == "销售A"


def test_coverage_public_doc_falls_back_to_document():
    row = SimpleNamespace(
        id="cv1",
        customer_id="c1",
        owner_user_id="u1",
        status="connected",
        client_dept=None,
        source_lead_id=None,
        sdr_name=None,
        sdr_transfer_date=None,
        isolation_version=None,
        document={
            "clientDept": "财务部",
            "sourceLeadId": "l9",
            "sdrName": "旧SDR",
            "sdrTransferDate": "2026-01-01",
            "isolationVersion": 2,
        },
    )
    out = _coverage_public_doc(row, can_edit=False)
    assert out["clientDept"] == "财务部"
    assert out["sourceLeadId"] == "l9"
    assert out["sdrName"] == "旧SDR"
    assert out["sdrTransferDate"] == "2026-01-01"
    assert out["isolationVersion"] == 2


def test_customer_master_columns_override_document():
    row = SimpleNamespace(
        company_uid="CUS-2026-0001",
        website="https://x.com",
        city="上海",
        industry_l2="软件服务",
        founded_date=date(2015, 3, 1),
        registered_capital=1000,
        scale="100-500 人",
        nature="民营",
        sdr_user_id="u9",
        sdr_transfer_date=date(2026, 5, 26),
        source="自拓",
        source_detail="行业会议",
        migration_status="done",
    )
    master = {"companyName": "Acme", "website": "", "city": ""}
    out = _customer_master_columns(row, master)
    assert out["companyUid"] == "CUS-2026-0001"
    assert out["website"] == "https://x.com"
    assert out["city"] == "上海"
    assert out["industryL2"] == "软件服务"
    assert out["foundedDate"] == "2015-03-01"
    assert out["registeredCapital"] == 1000.0
    assert out["scale"] == "100-500 人"
    assert out["nature"] == "民营"
    assert out["sdrUserId"] == "u9"
    assert out["sdrTransferDate"] == "2026-05-26"
    assert out["source"] == "自拓"
    assert out["sourceDetail"] == "行业会议"
    assert out["migrationStatus"] == "done"


@pytest.mark.asyncio
async def test_create_customer_sets_remaining_columns():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    await repo.create_customer(
        document={
            "id": "c1",
            "companyName": "Acme",
            "companyUid": "CUS-2026-0001",
            "website": "https://x.com",
            "city": "上海",
            "industryL2": "软件服务",
            "foundedDate": "2015-03-01",
            "registeredCapital": 1000,
            "scale": "100-500 人",
            "nature": "民营",
            "sdrUserId": "u9",
            "sdrTransferDate": "2026-05-26",
            "source": "自拓",
            "sourceDetail": "行业会议",
            "migrationStatus": "done",
            "subsidiaries": [],
        },
        owner_user_id="u1",
    )
    added = [c.args[0] for c in db.add.call_args_list]
    row = next(x for x in added if x.__class__.__name__ == "CrmCustomer")
    assert row.company_uid == "CUS-2026-0001"
    assert row.website == "https://x.com"
    assert row.city == "上海"
    assert row.industry_l2 == "软件服务"
    assert row.founded_date == date(2015, 3, 1)
    assert row.registered_capital == 1000.0
    assert row.scale == "100-500 人"
    assert row.nature == "民营"
    assert row.sdr_user_id == "u9"
    assert row.sdr_transfer_date == date(2026, 5, 26)
    assert row.source == "自拓"
    assert row.source_detail == "行业会议"
    assert row.migration_status == "done"


@pytest.mark.asyncio
async def test_create_coverage_sets_remaining_columns():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    await repo.create_coverage(
        customer_id="c1",
        owner_user_id="u1",
        document={
            "ownerName": "销售A",
            "clientDept": "市场部",
            "sourceLeadId": "l1",
            "sdrName": "SDR小张",
            "sdrTransferDate": "2026-05-26",
            "contacts": [],
            "notes": [],
            "attachments": [],
        },
    )
    added = [c.args[0] for c in db.add.call_args_list]
    row = next(x for x in added if x.__class__.__name__ == "CrmSalesCoverage")
    assert row.client_dept == "市场部"
    assert row.source_lead_id == "l1"
    assert row.sdr_name == "SDR小张"
    assert row.sdr_transfer_date == date(2026, 5, 26)
    assert row.isolation_version == 1


@pytest.mark.asyncio
async def test_save_customer_sets_remaining_columns():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(id="c1")
    await repo.save_customer(
        row,
        {
            "companyName": "Acme",
            "status": "connected",
            "city": "北京",
            "industryL2": "广告营销",
            "foundedDate": "2010-06-01",
            "registeredCapital": 500,
            "scale": "50-100 人",
            "nature": "外资",
            "source": "官网",
            "sourceDetail": "官网注册",
            "migrationStatus": "pending",
            "subsidiaries": [],
        },
    )
    assert row.city == "北京"
    assert row.industry_l2 == "广告营销"
    assert row.founded_date == date(2010, 6, 1)
    assert row.registered_capital == 500.0
    assert row.scale == "50-100 人"
    assert row.nature == "外资"
    assert row.source == "官网"
    assert row.source_detail == "官网注册"
    assert row.migration_status == "pending"


@pytest.mark.asyncio
async def test_save_coverage_sets_remaining_columns():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(id="cv1", customer_id="c1", owner_user_id="u1", status="connected")
    await repo.save_coverage(
        row,
        {
            "status": "connected",
            "clientDept": "财务部",
            "sourceLeadId": "l2",
            "sdrName": "SDR小李",
            "sdrTransferDate": "2026-06-12",
            "isolationVersion": 2,
            "contacts": [],
            "notes": [],
            "attachments": [],
        },
    )
    assert row.client_dept == "财务部"
    assert row.source_lead_id == "l2"
    assert row.sdr_name == "SDR小李"
    assert row.sdr_transfer_date == date(2026, 6, 12)
    assert row.isolation_version == 2
