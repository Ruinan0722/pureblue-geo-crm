"""线索序列化试点（阶段 E）：已列化字段以列为权威源，响应与 document 契约一致。"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.crm.repository import CrmRepository
from app.modules.crm.service.leads import _lead_response


def test_lead_response_uses_columns():
    row = SimpleNamespace(
        contact_title="经理",
        contact_department="市场部",
        contact_phone="13800000000",
        contact_wechat="wx",
        email="a@b.com",
        website="https://x.com",
        city="上海",
        invalid_reason="",
        wechat_added=True,
        document={
            "id": "l1",
            "companyName": "Acme",
            "status": "touched",
            "source": "自拓",
            "contactTitle": "经理",
            "contactDepartment": "市场部",
            "contactPhone": "13800000000",
            "contactWechat": "wx",
            "email": "a@b.com",
            "website": "https://x.com",
            "city": "上海",
            "invalidReason": "",
            "wechatAdded": True,
        },
    )
    out = _lead_response(row)
    assert out["contactTitle"] == "经理"
    assert out["contactDepartment"] == "市场部"
    assert out["contactPhone"] == "13800000000"
    assert out["contactWechat"] == "wx"
    assert out["email"] == "a@b.com"
    assert out["website"] == "https://x.com"
    assert out["city"] == "上海"
    assert out["wechatAdded"] is True
    assert out["companyName"] == "Acme"


def _row():
    document = {
        "id": "l1",
        "companyName": "Acme",
        "status": "touched",
        "source": "自拓",
        "importMeta": {
            "importedAt": "2026-07-27 17:09:07",
            "feishuLeadNo": "2827",
            "createdByName": "演示成员04",
            "feishuRecordId": "rec27A4IWXv9Ds",
            "landingpageRaw": "机构推荐",
            "utmSource": "百度",
        },
        "notes": [
            {
                "id": "ln1",
                "author": "演示成员04",
                "content": "已建联",
                "date": "2026-06-12",
                "wechatAdded": True,
                "mentions": ["李四"],
                "followType": "phone",
            }
        ],
    }
    return SimpleNamespace(
        contact_title=None,
        contact_department=None,
        contact_phone=None,
        contact_wechat=None,
        email=None,
        website=None,
        city=None,
        invalid_reason=None,
        wechat_added=None,
        document=document,
    )


def test_lead_response_uses_children_tables():
    """子表为权威源时，importMeta/notes 响应与 document 契约一致。"""
    row = _row()
    out = _lead_response(
        row,
        importMeta={
            "importedAt": "2026-07-27 17:09:07",
            "feishuLeadNo": "2827",
            "createdByName": "演示成员04",
            "feishuRecordId": "rec27A4IWXv9Ds",
            "landingpageRaw": "机构推荐",
            "utmSource": "百度",
        },
        notes=[
            {
                "id": "ln1",
                "author": "演示成员04",
                "content": "已建联",
                "date": "2026-06-12",
                "wechatAdded": True,
                "mentions": ["李四"],
                "followType": "phone",
            }
        ],
    )
    assert out["importMeta"] == row.document["importMeta"]
    assert out["notes"] == row.document["notes"]


@pytest.mark.asyncio
async def test_list_lead_children_assembles_table_rows():
    db = AsyncMock()
    repo = CrmRepository(db)
    note_row = SimpleNamespace(
        id="ln1",
        lead_id="l1",
        author="演示成员04",
        content="已建联",
        date=datetime(2026, 6, 12),
        follow_type="phone",
        wechat_added=True,
        mentions=["李四"],
        next_follow_at=None,
        sort_order=0,
    )
    meta_row = SimpleNamespace(
        lead_id="l1",
        imported_at=datetime(2026, 7, 27, 17, 9, 7),
        feishu_lead_no="2827",
        created_by_name="演示成员04",
        feishu_record_id="rec27A4IWXv9Ds",
        landingpage_raw="机构推荐",
        utm_source="百度",
        platform=None,
        external_record_id=None,
        operator_name=None,
    )
    db.execute.side_effect = [
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [note_row])),
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [meta_row])),
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=list)),  # attachments
    ]
    out = await repo.list_lead_children(["l1"])
    assert out["l1"]["notes"] == [
        {
            "id": "ln1",
            "author": "演示成员04",
            "content": "已建联",
            "date": "2026-06-12",
            "followType": "phone",
            "wechatAdded": True,
            "mentions": ["李四"],
        }
    ]
    assert out["l1"]["attachments"] == []
    assert out["l1"]["importMeta"] == {
        "importedAt": "2026-07-27 17:09:07",
        "feishuLeadNo": "2827",
        "createdByName": "演示成员04",
        "feishuRecordId": "rec27A4IWXv9Ds",
        "landingpageRaw": "机构推荐",
        "utmSource": "百度",
    }
