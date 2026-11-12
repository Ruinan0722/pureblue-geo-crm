"""需求/项目 compose 残留：owner 响应、update_data 不抹 importMeta、projects 假 _doc。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.requests.repository import RequestRepository
from app.modules.requests.repository_helpers import _empty_request_children


@pytest.mark.asyncio
async def test_update_owner_returns_composed_children(monkeypatch):
    repo = RequestRepository(AsyncMock())
    row = SimpleNamespace(
        id="r1",
        code="REQ-1",
        status="submitted",
        submitted_at=None,
        updated_at=None,
        owner="销售",
        staff_user_id="u1",
        invite_id=None,
        opportunity_id=None,
        company_name="Acme",
        brand_name=None,
        goal=None,
        geo_source=None,
    )
    notes = [{"id": "n1", "author": "a", "content": "keep", "createdAt": "2026-08-01"}]
    meta = {"source": "国内GEO需求"}

    async def fake_get(rid):
        return row if rid == "r1" else None

    async def fake_children(rid):
        ch = _empty_request_children()
        ch["notes"] = list(notes)
        ch["importMeta"] = dict(meta)
        return ch

    monkeypatch.setattr(repo, "get_by_id", fake_get)
    monkeypatch.setattr(repo, "get_request_children", fake_children)

    async def fake_execute(*_a, **_k):
        row.owner = "新销售"
        row.staff_user_id = "u2"
        return AsyncMock()

    monkeypatch.setattr(repo.db, "execute", fake_execute)

    out = await repo.update_owner("r1", "新销售", "u2")
    assert out is not None
    assert out.owner == "新销售"
    assert next(n.model_dump(by_alias=True) for n in out.notes)["content"] == "keep"
    assert (out.data or {}).get("importMeta", {}).get("source") == "国内GEO需求"


@pytest.mark.asyncio
async def test_update_data_preserves_import_meta_when_omitted(monkeypatch):
    repo = RequestRepository(AsyncMock())
    row = SimpleNamespace(
        id="r1",
        code="REQ-1",
        status="submitted",
        submitted_at=None,
        updated_at=None,
        owner="销售",
        staff_user_id="u1",
        invite_id=None,
        opportunity_id=None,
        company_name="旧公司",
        brand_name=None,
        goal=None,
        geo_source="domestic",
    )
    prev_meta = {"source": "国内GEO需求", "feishuRecordId": "rec-1"}
    synced: list[dict] = []

    async def fake_get(rid):
        return row if rid == "r1" else None

    async def fake_children(rid):
        ch = _empty_request_children()
        ch["importMeta"] = dict(prev_meta)
        ch["regions"] = [{"country": "中国", "language": "中文"}]
        ch["notes"] = []
        ch["attachments"] = []
        return ch

    async def fake_sync(request_id, data, *, notes, attachments):
        synced.append(dict(data or {}))

    async def fake_record(r):
        from app.modules.requests.repository_helpers import _row_to_record

        ch = await fake_children(r.id)
        # simulate post-update assemble with synced data
        if synced:
            ch = {**ch, "importMeta": synced[-1].get("importMeta")}
        return _row_to_record(r, ch)

    monkeypatch.setattr(repo, "get_by_id", fake_get)
    monkeypatch.setattr(repo, "get_request_children", fake_children)
    monkeypatch.setattr(repo, "_sync_form_rows", fake_sync)
    monkeypatch.setattr(repo, "_record_with_children", fake_record)
    monkeypatch.setattr(repo.db, "execute", AsyncMock())

    await repo.update_data("r1", {"companyName": "新公司"})
    assert synced, "应调用 _sync_form_rows"
    assert synced[0].get("importMeta") == prev_meta
    assert synced[0].get("regions") == [{"country": "中国", "language": "中文"}]


@pytest.mark.asyncio
async def test_ensure_from_contract_id_uses_contract_columns_not_document_json(monkeypatch):
    """ops 补建不得依赖已删的 contract.document JSON。"""
    from app.modules.auth.schemas import AuthUser
    from app.modules.projects.service import ProjectsService

    svc = ProjectsService(AsyncMock())
    contract_row = SimpleNamespace(
        id="ct-1",
        customer_id="c-1",
        opportunity_id="opp-1",
        company="客户公司",
        name="合同名",
        amount=100,
        owner="销售",
        region="国内",
        city="北京",
        status="signed",
        geo_source="domestic",
    )
    # 无 document 属性，模拟 JSON 列已删
    assert not hasattr(contract_row, "document") or getattr(contract_row, "document", None) is None

    monkeypatch.setattr(svc, "_assert_section", lambda *_a, **_k: None)
    monkeypatch.setattr(svc, "_is_ops_admin", lambda *_a, **_k: True)
    svc.crm.get_contract = AsyncMock(return_value=contract_row)
    svc.crm.list_contract_owners = AsyncMock(return_value={"ct-1": ["销售"]})
    svc.crm.get_contract_attachments = AsyncMock(return_value=[])
    svc.crm.get_customer = AsyncMock(
        return_value=SimpleNamespace(
            id="c-1",
            company_name="客户公司",
            region="国内",
            city="北京",
            industry_l1="互联网",
            industry_l2=None,
        )
    )
    svc.crm.get_opportunity = AsyncMock(
        return_value=SimpleNamespace(id="opp-1", customer_id="c-1", stage="won")
    )
    svc.crm.get_opportunity_children = AsyncMock(
        return_value={
            "projectTypes": ["监测"],
            "requestIds": [],
            "notes": [],
            "advisorNotes": [],
            "attachments": [],
            "stageHistory": [],
        }
    )

    created: dict = {}

    async def fake_ensure(doc, *, actor=None, commit=False):
        created["doc"] = dict(doc)
        return SimpleNamespace(id="p-1")

    monkeypatch.setattr(svc, "ensure_from_contract_document", fake_ensure)
    svc.repo.list_string_items = AsyncMock(return_value={"p-1": {}})
    monkeypatch.setattr(
        svc,
        "_to_record",
        lambda row, string_items=None: SimpleNamespace(id=row.id, name="ok"),
    )

    user = AuthUser(
        id="admin",
        feishu_open_id="ou",
        name="管理员",
        role="admin",
        permissions=["section:projects", "section:settings"],
        data_scope="all",
    )
    out = await svc.ensure_from_contract_id(user, "ct-1")
    assert out.id == "p-1"
    assert created["doc"].get("id") == "ct-1"
    assert created["doc"].get("customerId") == "c-1"
