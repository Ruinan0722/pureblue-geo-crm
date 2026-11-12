"""客户跟进记录勾选联系人后：联系人状态从「待建联」升级为「已建联」。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService
from app.modules.crm.service.customers_coverage import _mark_follow_up_contacts_connected


def _user(*, user_id: str = "u-a", role: str = "sales") -> AuthUser:
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name="销售A",
        role=role,
        permissions=["section:customers", "customers:follow_add"],
        data_scope="own",
        department_names=["销售部"],
    )


def test_mark_follow_up_contacts_connected_only_upgrades_awaiting():
    contacts = [
        {"id": "ct1", "name": "张三", "status": "awaiting_contact"},
        {"id": "ct2", "name": "李四", "status": "potential"},
        {"id": "ct3", "name": "王五", "status": "connected"},
        {"id": "ct4", "name": "赵六", "status": "opportunity_following"},
        {"id": "ct5", "name": "孙七", "status": "cooperating"},
        {"id": "ct6", "name": "周八", "status": "stopped"},
        {"id": "ct7", "name": "吴九"},
    ]
    notes = [
        {"id": "f1", "content": "首次沟通", "contactId": "ct1"},
        {"id": "f2", "content": "历史跟进", "contactId": "ct2"},
        {"id": "f3", "content": "已建联", "contactId": "ct3"},
        {"id": "f4", "content": "商机中", "contactId": "ct4"},
        {"id": "f5", "content": "已合作", "contactId": "ct5"},
        {"id": "f6", "content": "停止", "contactId": "ct6"},
        {"id": "f7", "content": "缺状态", "contactId": "ct7"},
    ]
    _mark_follow_up_contacts_connected(contacts, notes)
    assert contacts[0]["status"] == "connected"
    assert contacts[1]["status"] == "connected"
    assert contacts[2]["status"] == "connected"
    assert contacts[3]["status"] == "opportunity_following"
    assert contacts[4]["status"] == "cooperating"
    assert contacts[5]["status"] == "stopped"
    assert contacts[6]["status"] == "connected"


def test_mark_follow_up_contacts_connected_ignores_notes_without_contact():
    contacts = [{"id": "ct1", "name": "张三", "status": "awaiting_contact"}]
    _mark_follow_up_contacts_connected(contacts, [{"id": "f1", "content": "无联系人"}])
    assert contacts[0]["status"] == "awaiting_contact"


@pytest.mark.asyncio
async def test_update_coverage_flips_followed_contact_to_connected(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    user = _user()
    row = SimpleNamespace(
        id="cv1",
        customer_id="c1",
        owner_user_id="u-a",
        status="connected",
        document={"ownerName": "销售A"},
    )
    saved: dict = {}

    async def fake_save_coverage(cov_row, document, *, status=None):
        saved["document"] = document
        saved["status"] = status
        return cov_row

    monkeypatch.setattr(svc.repo, "get_coverage", AsyncMock(return_value=row))
    monkeypatch.setattr(svc, "_assert_coverage_access", AsyncMock())
    monkeypatch.setattr(
        svc.repo,
        "list_coverage_children",
        AsyncMock(
            return_value={
                "cv1": {
                    "contacts": [
                        {"id": "ct1", "name": "张三", "status": "awaiting_contact"},
                        {"id": "ct2", "name": "李四", "status": "opportunity_following"},
                    ],
                    "notes": [],
                    "attachments": [],
                }
            }
        ),
    )
    monkeypatch.setattr(svc.repo, "save_coverage", fake_save_coverage)
    monkeypatch.setattr(
        svc.repo,
        "get_customer",
        AsyncMock(
            return_value=SimpleNamespace(
                id="c1", document={"companyName": "Acme"}, status="connected"
            )
        ),
    )
    monkeypatch.setattr(svc.repo, "list_customer_subsidiaries", AsyncMock(return_value=[]))
    monkeypatch.setattr(svc.repo, "save_customer", AsyncMock())
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())
    monkeypatch.setattr(svc, "get_coverage", AsyncMock(return_value={"ok": True}))

    await svc.update_coverage(
        user,
        "cv1",
        {
            "notes": [{"id": "f1", "content": "首次沟通", "contactId": "ct1"}],
            "lastFollowAt": "2026-08-11",
            "nextFollowAt": "",
        },
    )

    contacts = saved["document"]["contacts"]
    by_id = {c["id"]: c for c in contacts}
    assert by_id["ct1"]["status"] == "connected"
    assert by_id["ct2"]["status"] == "opportunity_following"
