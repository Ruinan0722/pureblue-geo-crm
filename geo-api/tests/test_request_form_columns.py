"""需求表单 data 全列化：列/子表组装契约 + 写穿 + children 读取。"""

from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.requests.repository import RequestRepository, _row_to_record


def _row():
    return SimpleNamespace(
        id="r1",
        code="GEO-CN-ABC",
        status="confirmed",
        submitted_at=datetime(2026, 8, 1, 10, 0, 0),
        updated_at=datetime(2026, 8, 2, 9, 0, 0),
        owner="张三",
        staff_user_id="u1",
        invite_id=None,
        opportunity_id=None,
        company_name="Acme",
        brand_name="Acme",
        goal="recommend",
        scope_type="brand_only",
        has_overseas_site="no",
        overseas_site_url="",
        target_customer="toc",
        optimize_background="优化背景",
        intent_type="clear",
        intent_rough="",
        optimize_period="3",
        optimize_period_custom="",
        expected_start_date=date(2026, 9, 1),
        strength_market="",
        strength_tech="技术能力强",
        strength_brand="",
        strength_ecosystem="",
        strength_other="",
        contact_name="李四",
        contact_phone="13800000000",
        contact_title="经理",
        budget="",
        period="3个月",
        website="",
        competitors="竞品A",
        expected_start=None,
        customer_no="",
        feishu_code="",
        project_stage="",
        city="",
        industry="",
        budget_range="",
        data={},
        notes=[],
        attachments=[],
    )


def _children():
    return {
        "regions": [{"country": "中国", "language": "中文"}],
        "goals": [],
        "products": [
            {
                "id": "p1",
                "name": "监测",
                "fn": "功能",
                "users": "目标用户",
                "scenario": "应用场景",
            }
        ],
        "intentQuestions": [{"id": "iq1", "productId": "p1", "text": "用户问题"}],
        "intentRoughItems": [],
        "platforms": ["豆包"],
        "brandAliases": [],
        "brandCompetitors": ["竞品B"],
        "feishuLinks": [],
        "importMeta": {
            "source": "国内GEO需求",
            "feishuRecordId": "rec1",
            "importedAt": "2026-08-03 14:09:41",
        },
    }


def test_row_to_record_assembles_data_from_columns_and_children():
    rec = _row_to_record(_row(), _children())
    data = rec.data
    assert data["companyName"] == "Acme"
    assert data["scopeType"] == "brand_only"
    assert data["hasOverseasSite"] == "no"
    assert data["targetCustomer"] == "toc"
    assert data["expectedStartDate"] == "2026-09-01"
    assert data["expectedStart"] == ""
    assert data["strengthTech"] == "技术能力强"
    assert data["budget"] == ""
    assert data["products"] == _children()["products"]
    assert data["intentQuestions"] == [{"id": "iq1", "productId": "p1", "text": "用户问题"}]
    assert data["platforms"] == ["豆包"]
    assert data["brandCompetitors"] == ["竞品B"]
    assert data["regions"] == [{"country": "中国", "language": "中文"}]
    assert data["importMeta"] == _children()["importMeta"]


def test_row_to_record_falls_back_to_data_json():
    row = _row()
    row.data = {
        "companyName": "Acme",
        "goal": "recommend",
        "products": [{"id": "p1", "name": "监测"}],
    }
    rec = _row_to_record(row)
    assert rec.data["products"] == [{"id": "p1", "name": "监测"}]


@pytest.mark.asyncio
async def test_insert_syncs_form_subtables():
    db = AsyncMock()
    db.add = MagicMock()
    db.execute.return_value = SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=list)
    )
    repo = RequestRepository(db)
    await repo.insert(
        staff_user_id="u1",
        invite_id=None,
        owner_name="张三",
        status="submitted",
        data={
            "companyName": "Acme",
            "goal": "recommend",
            "products": [
                {
                    "id": "p1",
                    "name": "监测",
                    "fn": "功能",
                    "users": "目标用户",
                    "scenario": "应用场景",
                }
            ],
            "intentQuestions": [{"id": "iq1", "productId": "p1", "text": "用户问题"}],
            "platforms": ["豆包"],
            "importMeta": {
                "source": "国内GEO需求",
                "feishuRecordId": "rec1",
                "importedAt": "2026-08-03 14:09:41",
            },
            "scopeType": "brand_only",
            "targetCustomer": "both",
            "expectedStartDate": "2026-09-01",
        },
    )
    added = [c.args[0] for c in db.add.call_args_list]
    products = [x for x in added if x.__class__.__name__ == "RequestProduct"]
    intents = [x for x in added if x.__class__.__name__ == "RequestIntentItem"]
    lists = [x for x in added if x.__class__.__name__ == "RequestListItem"]
    metas = [x for x in added if x.__class__.__name__ == "RequestImportMeta"]
    assert len(products) == 1
    assert products[0].item_id == "p1"
    assert products[0].name == "监测"
    assert len(intents) == 1
    assert intents[0].kind == "questions"
    assert intents[0].product_id == "p1"
    assert len(lists) == 1
    assert lists[0].kind == "platforms"
    assert lists[0].value == "豆包"
    assert len(metas) == 1
    assert metas[0].source == "国内GEO需求"
    assert metas[0].feishu_record_id == "rec1"
    row = next(x for x in added if x.__class__.__name__ == "Request")
    assert row.scope_type == "brand_only"
    assert row.target_customer == "both"
    assert row.expected_start_date == date(2026, 9, 1)


@pytest.mark.asyncio
async def test_list_request_children_assembles():
    db = AsyncMock()
    db.add = MagicMock()
    repo = RequestRepository(db)

    def results(xs):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: xs))

    db.execute.side_effect = [
        results([SimpleNamespace(request_id="r1", platform=None, country="中国", language="中文")]),
        results([SimpleNamespace(request_id="r1", goal="recommend")]),
        results(
            [
                SimpleNamespace(
                    request_id="r1",
                    item_id="p1",
                    id="r1-pr-0",
                    name="监测",
                    fn="功能",
                    users="目标用户",
                    scenario="应用场景",
                    competitors=None,
                )
            ]
        ),
        results(
            [
                SimpleNamespace(
                    request_id="r1",
                    kind="questions",
                    item_id="iq1",
                    id="r1-it-questions-0",
                    product_id="p1",
                    text="用户问题",
                )
            ]
        ),
        results(
            [SimpleNamespace(request_id="r1", kind="platforms", value="豆包")]
        ),
        results([]),
        results(
            [
                SimpleNamespace(
                    request_id="r1",
                    source="国内GEO需求",
                    feishu_record_id="rec1",
                    imported_at=datetime(2026, 8, 3, 14, 9, 41),
                )
            ]
        ),
        results([]),
        results([]),
    ]
    out = await repo.list_request_children(["r1"])
    bucket = out["r1"]
    assert bucket["regions"] == [{"platform": "", "country": "中国", "language": "中文"}]
    assert bucket["goals"] == ["recommend"]
    assert bucket["products"] == [
        {
            "id": "p1",
            "name": "监测",
            "fn": "功能",
            "users": "目标用户",
            "scenario": "应用场景",
            "competitors": "",
        }
    ]
    assert bucket["intentQuestions"] == [{"id": "iq1", "productId": "p1", "text": "用户问题"}]
    assert bucket["platforms"] == ["豆包"]
    assert bucket["importMeta"] == {
        "source": "国内GEO需求",
        "feishuRecordId": "rec1",
        "importedAt": "2026-08-03 14:09:41",
    }
    assert bucket["notes"] == []
    assert bucket["attachments"] == []
