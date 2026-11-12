"""商机序列化试点（阶段 E）：列/子表为权威源，响应契约与 document 完全一致。

联调保障：同一业务数据，旧 document 序列化与新「列+子表」序列化输出一致；
商机响应覆盖前端 Opportunity 接口全部字段。
"""

from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.crm.repository import CrmRepository
from app.modules.crm.service.helpers_opportunities import _opportunity_doc, _opportunity_response

FRONTEND_OPPORTUNITY_FIELDS = [
    "id",
    "name",
    "customerId",
    "subsidiaryId",
    "subsidiaryName",
    "brandName",
    "region",
    "geoSource",
    "goal",
    "platform",
    "period",
    "amount",
    "probability",
    "expectedSignDate",
    "stage",
    "owner",
    "advisor",
    "customerSuccess",
    "projectTypes",
    "primaryContactId",
    "requestIds",
    "notes",
    "advisorNotes",
    "createdAt",
    "lastFollowAt",
    "nextFollowAt",
    "stageHistory",
    "attachments",
    "lostStage",
    "lostReasonL1",
    "lostReasonL2",
    "lostReason",
    "competitor",
]


def _row(**overrides):
    document = {
        "id": "o1",
        "name": "测试商机",
        "customerId": "c1",
        "subsidiaryId": "",
        "subsidiaryName": "",
        "brandName": "Acme",
        "region": "华东区",
        "geoSource": "domestic",
        "goal": "recommend_60",
        "platform": "豆包",
        "period": "6 个月",
        "amount": 100000,
        "probability": 60,
        "expectedSignDate": "2026-08-01",
        "stage": "solution_confirm",
        "owner": "张三",
        "advisor": "",
        "customerSuccess": "",
        "projectTypes": ["监测"],
        "primaryContactId": "",
        "requestIds": [],
        "notes": [
            {
                "id": "of1",
                "author": "张三",
                "content": "已电话沟通",
                "date": "2026-07-20 10:00:00",
                "followType": "phone",
                "wechatAdded": True,
                "mentions": ["李四"],
                "nextFollowAt": "2026-08-15",
            }
        ],
        "advisorNotes": [
            {
                "id": "ad1",
                "author": "售前顾问",
                "content": "建议进入方案确认",
                "date": "2026-07-25 14:30:00",
                "origin": "request",
                "sourceRequestId": "r1",
                "sourceRequestNoteId": "rn1",
            }
        ],
        "createdAt": "2026-07-01",
        "lastFollowAt": "2026-07-20",
        "nextFollowAt": "2026-08-15",
        "stageHistory": [
            {
                "stage": "contact",
                "enteredAt": "2026-07-01 10:00:00",
                "leftAt": "",
                "reason": "",
                "changeType": "advance",
            }
        ],
        "attachments": [
            {"id": "a1", "name": "f.pdf", "size": 10, "kind": "contract", "url": "u"}
        ],
        "lostStage": "签署中",
        "lostReasonL1": "预算与价格原因",
        "lostReasonL2": "客户预算不足",
        "lostReason": "预算不足",
        "competitor": "",
    }
    document.update(overrides.get("document") or {})
    return SimpleNamespace(
        id="o1",
        owner_user_id="u1",
        stage="solution_confirm",
        amount=100000,
        expected_sign_date=date(2026, 8, 1),
        last_follow_at=date(2026, 7, 20),
        next_follow_at=date(2026, 8, 15),
        lost_reason="预算不足",
        name="测试商机",
        brand_name="Acme",
        region="华东区",
        geo_source="domestic",
        goal="recommend_60",
        platform="豆包",
        period="6 个月",
        probability=60,
        owner="张三",
        advisor="",
        customer_success="",
        subsidiary_id="",
        subsidiary_name="",
        primary_contact_id="",
        lost_stage="签署中",
        lost_reason_l1="预算与价格原因",
        lost_reason_l2="客户预算不足",
        competitor="",
        document=document,
    )


def test_response_covers_frontend_opportunity_contract():
    """商机响应覆盖前端 Opportunity 接口全部字段（联调契约）。"""
    out = _opportunity_response(_row())
    missing = [k for k in FRONTEND_OPPORTUNITY_FIELDS if k not in out]
    assert not missing, f"缺少前端契约字段: {missing}"


def test_columns_and_tables_match_document_contract():
    """列/子表为权威源时，响应与 document 序列化逐字段一致（无回归）。"""
    row = _row()
    doc = _opportunity_doc(row)
    out = _opportunity_response(
        row,
        stageHistory=doc["stageHistory"],
        attachments=doc["attachments"],
        projectTypes=doc["projectTypes"],
        requestIds=doc["requestIds"],
        notes=doc["notes"],
        advisorNotes=doc["advisorNotes"],
    )
    for key in (
        "stage",
        "amount",
        "expectedSignDate",
        "lastFollowAt",
        "nextFollowAt",
        "lostReason",
        "stageHistory",
        "attachments",
        "name",
        "brandName",
        "region",
        "geoSource",
        "goal",
        "platform",
        "period",
        "probability",
        "owner",
        "lostStage",
        "lostReasonL1",
        "lostReasonL2",
        "competitor",
        "projectTypes",
        "requestIds",
        "notes",
        "advisorNotes",
    ):
        assert out[key] == doc[key], f"字段 {key} 列/表序列化与 document 不一致"


@pytest.mark.asyncio
async def test_list_opportunity_children_assembles_table_rows():
    """子表行 → 前端契约驼峰结构（阶段历史 / 附件）。"""
    db = AsyncMock()
    repo = CrmRepository(db)
    history_row = SimpleNamespace(
        opportunity_id="o1",
        stage="contact",
        entered_at=datetime(2026, 7, 1, 10, 0, 0),
        left_at=None,
        reason="",
        change_type="advance",
        sort_order=0,
    )
    att_row = SimpleNamespace(
        entity_type="opportunity",
        entity_id="o1",
        id="a1",
        name="f.pdf",
        size=10,
        kind="contract",
        url="u",
        storage_path=None,
        content_type="pdf",
        description=None,
        checksum=None,
        uploaded_by=None,
        uploaded_at=None,
        origin=None,
        source_lead_id=None,
        source_lead_attachment_id=None,
        source_request_id=None,
        source_request_attachment_id=None,
    )
    pt_row = SimpleNamespace(opportunity_id="o1", project_type="监测")
    ri_row = SimpleNamespace(opportunity_id="o1", request_id="r1")
    sales_note = SimpleNamespace(
        id="of1",
        opportunity_id="o1",
        kind="sales",
        author="张三",
        content="已电话沟通",
        date=datetime(2026, 7, 20, 10, 0, 0),
        follow_type="phone",
        wechat_added=True,
        mentions=["李四"],
        next_follow_at=date(2026, 8, 15),
        origin=None,
        source_request_id=None,
        source_request_note_id=None,
        sort_order=0,
    )
    advisor_note = SimpleNamespace(
        id="ad1",
        opportunity_id="o1",
        kind="advisor",
        author="售前顾问",
        content="建议进入方案确认",
        date=datetime(2026, 7, 25, 14, 30, 0),
        follow_type=None,
        wechat_added=False,
        mentions=None,
        next_follow_at=None,
        origin="request",
        source_request_id="r1",
        source_request_note_id="rn1",
        sort_order=0,
    )
    db.execute.side_effect = [
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [history_row])),
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [att_row])),
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [pt_row])),
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [sales_note, advisor_note])),
    ]
    out = await repo.list_opportunity_children(["o1"])
    assert out["o1"]["stageHistory"][0]["stage"] == "contact"
    assert out["o1"]["stageHistory"][0]["enteredAt"] == "2026-07-01 10:00:00"
    assert out["o1"]["attachments"][0]["id"] == "a1"
    assert out["o1"]["attachments"][0]["storagePath"] is None
    assert out["o1"]["projectTypes"] == ["监测"]
    assert out["o1"]["requestIds"] == []
    assert out["o1"]["notes"] == [
        {
            "id": "of1",
            "author": "张三",
            "content": "已电话沟通",
            "date": "2026-07-20 10:00:00",
            "followType": "phone",
            "wechatAdded": True,
            "mentions": ["李四"],
            "nextFollowAt": "2026-08-15",
        }
    ]
    assert out["o1"]["advisorNotes"] == [
        {
            "id": "ad1",
            "author": "售前顾问",
            "content": "建议进入方案确认",
            "date": "2026-07-25 14:30:00",
            "origin": "request",
            "sourceRequestId": "r1",
            "sourceRequestNoteId": "rn1",
        }
    ]
