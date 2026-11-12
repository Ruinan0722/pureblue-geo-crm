"""商机跟进/顾问反馈子表：create/save 写穿 → opportunity_notes。"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.crm.repository import CrmRepository


def _note_rows() -> list[dict]:
    return [
        {
            "id": "of1",
            "author": "张三",
            "content": "已电话沟通",
            "date": "2026-8-7 10:30:45",
            "followType": "phone",
            "wechatAdded": True,
            "mentions": ["李四"],
            "nextFollowAt": "2026-08-15",
        }
    ]


@pytest.mark.asyncio
async def test_create_opportunity_syncs_notes_to_subtable():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    await repo.create_opportunity(
        document={
            "id": "o1",
            "customerId": "c1",
            "notes": _note_rows(),
            "advisorNotes": [
                {
                    "id": "ad1",
                    "author": "售前顾问",
                    "content": "建议进入方案确认",
                    "date": "2026-08-06",
                    "origin": "request",
                    "sourceRequestId": "r1",
                    "sourceRequestNoteId": "rn1",
                }
            ],
            "attachments": [],
            "stageHistory": [],
            "projectTypes": [],
            "requestIds": [],
        },
        owner_user_id="u1",
    )

    added = [c.args[0] for c in db.add.call_args_list]
    notes = [x for x in added if x.__class__.__name__ == "OpportunityNote"]
    assert len(notes) == 2
    sales = next(n for n in notes if n.kind == "sales")
    advisor = next(n for n in notes if n.kind == "advisor")

    assert sales.id == "of1"
    assert sales.opportunity_id == "o1"
    assert sales.author == "张三"
    assert sales.content == "已电话沟通"
    # 前端 zh-CN 非补零日期 '2026-8-7 10:30:45' 需宽松解析
    assert sales.date == datetime(2026, 8, 7, 10, 30, 45)
    assert sales.follow_type == "phone"
    assert sales.wechat_added is True
    assert sales.mentions == '["李四"]'
    assert sales.next_follow_at == datetime(2026, 8, 15).date()
    assert sales.sort_order == 0

    assert advisor.origin == "request"
    assert advisor.source_request_id == "r1"
    assert advisor.source_request_note_id == "rn1"
    assert advisor.wechat_added is False
    assert advisor.mentions is None
    assert advisor.next_follow_at is None


@pytest.mark.asyncio
async def test_save_opportunity_syncs_notes_to_subtable():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(id="o1", customer_id="c1")
    await repo.save_opportunity(
        row,
        {
            "customerId": "c1",
            "stage": "contact",
            "notes": _note_rows(),
            "advisorNotes": [],
            "attachments": [],
            "stageHistory": [],
            "projectTypes": [],
            "requestIds": [],
        },
    )

    added = [c.args[0] for c in db.add.call_args_list]
    notes = [x for x in added if x.__class__.__name__ == "OpportunityNote"]
    assert len(notes) == 1
    assert notes[0].opportunity_id == "o1"
    assert notes[0].kind == "sales"
    assert notes[0].content == "已电话沟通"
