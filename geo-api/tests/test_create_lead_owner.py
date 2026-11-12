"""新建线索：未分配销售时仍归属创建人（SDR/销售 own 可见）。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService


def _user(*, user_id: str, name: str, role: str, scope: str = "own") -> AuthUser:
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name=name,
        role=role,
        permissions=["section:leads", "leads:write"],
        data_scope=scope,
        department_names=["销售部"],
    )


@pytest.mark.asyncio
async def test_create_lead_unassigned_sales_still_owned_by_sdr(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    captured: dict = {}

    async def fake_create(*, document, owner_user_id):
        lead_id = str(document.get("id") or "l-test")
        doc = {**document, "id": lead_id}
        captured["document"] = doc
        captured["owner_user_id"] = owner_user_id
        return SimpleNamespace(
            id=lead_id,
            owner_user_id=owner_user_id,
            document=doc,
            created_at=None,
        )

    monkeypatch.setattr(svc.repo, "create_lead", fake_create)
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    user = _user(user_id="u-sdr", name="周 SDR", role="sdr")
    doc = await svc.create_lead(
        user,
        {
            "companyName": "测试公司",
            "contactName": "张三",
            "contactPhone": "13800000000",
            "source": "官网注册",
            "sales": "未分配",
        },
    )

    assert captured["owner_user_id"] == "u-sdr"
    assert captured["document"]["sales"] == "未分配"
    assert captured["document"]["sdr"] == "周 SDR"
    assert doc["companyName"] == "测试公司"


@pytest.mark.asyncio
async def test_create_lead_unassigned_sales_owned_by_sales_creator(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    captured: dict = {}

    async def fake_create(*, document, owner_user_id):
        captured["owner_user_id"] = owner_user_id
        return SimpleNamespace(
            id=document.get("id") or "l1",
            owner_user_id=owner_user_id,
            document={**document, "id": document.get("id") or "l1"},
            created_at=None,
        )

    monkeypatch.setattr(svc.repo, "create_lead", fake_create)
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    user = _user(user_id="u-sales", name="销售甲", role="sales")
    await svc.create_lead(
        user,
        {"companyName": "甲公司", "sales": "未分配", "source": "官网注册"},
    )
    assert captured["owner_user_id"] == "u-sales"


@pytest.mark.asyncio
async def test_create_lead_rejects_manual_converted_status():
    """「已转客户」只能由生成客户流程写入，新建线索接口必须拒绝。"""
    db = AsyncMock()
    svc = CrmService(db)
    user = _user(user_id="u-sdr", name="周 SDR", role="sdr")
    with pytest.raises(ValidationError):
        await svc.create_lead(
            user,
            {
                "companyName": "测试公司",
                "contactName": "张三",
                "contactPhone": "13800000000",
                "source": "官网注册",
                "status": "converted",
            },
        )


@pytest.mark.asyncio
async def test_update_lead_rejects_manual_converted_status():
    """编辑线索接口同样禁止手动写入已转客户状态。"""
    db = AsyncMock()
    svc = CrmService(db)
    user = _user(user_id="u-sdr", name="周 SDR", role="sdr")
    with pytest.raises(ValidationError):
        await svc.update_lead(user, "l1", {"status": "converted"})


@pytest.mark.asyncio
async def test_update_lead_rejects_invalid_lead_edit(monkeypatch):
    """无效线索与已转客户对齐：关闭后不允许二次修改（含跟进/附件）。"""
    db = AsyncMock()
    svc = CrmService(db)
    user = _user(user_id="u-sdr", name="周 SDR", role="sdr")
    row = SimpleNamespace(id="l1", owner_user_id="u-sdr", status="invalid")
    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=["u-sdr"]))
    with pytest.raises(ValidationError):
        await svc.update_lead(user, "l1", {"companyName": "改名"})
