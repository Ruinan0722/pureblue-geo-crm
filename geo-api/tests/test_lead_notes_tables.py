"""线索跟进/导入元数据子表：create/save 写穿 → lead_notes / crm_lead_import_meta。"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.crm.repository import CrmRepository


@pytest.mark.asyncio
async def test_create_lead_syncs_notes_and_import_meta():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    await repo.create_lead(
        document={
            "id": "l1",
            "companyName": "Acme",
            "importMeta": {
                "importedAt": "2026-07-27 17:09:07",
                "feishuLeadNo": "2827",
                "createdByName": "演示成员04",
                "feishuRecordId": "rec27A4IWXv9Ds",
                "landingpageRaw": "机构推荐",
            },
            "notes": [
                {
                    "id": "ln1",
                    "author": "演示成员04",
                    "content": "已建联",
                    "date": "2026-8-7 10:30:45",
                    "wechatAdded": True,
                    "mentions": ["李四"],
                    "followType": "phone",
                }
            ],
            "attachments": [],
        },
        owner_user_id="u1",
    )

    added = [c.args[0] for c in db.add.call_args_list]
    notes = [x for x in added if x.__class__.__name__ == "LeadNote"]
    metas = [x for x in added if x.__class__.__name__ == "CrmLeadImportMeta"]
    assert len(notes) == 1
    assert len(metas) == 1

    note = notes[0]
    assert note.id == "ln1"
    assert note.lead_id == "l1"
    assert note.author == "演示成员04"
    assert note.content == "已建联"
    # 前端 zh-CN 非补零日期 '2026-8-7 10:30:45' 需宽松解析
    assert note.date == datetime(2026, 8, 7, 10, 30, 45)
    assert note.wechat_added is True
    assert note.mentions == '["李四"]'
    assert note.follow_type == "phone"
    assert note.sort_order == 0

    meta = metas[0]
    assert meta.lead_id == "l1"
    assert meta.feishu_record_id == "rec27A4IWXv9Ds"
    assert meta.feishu_lead_no == "2827"
    assert meta.created_by_name == "演示成员04"
    assert meta.landingpage_raw == "机构推荐"
    assert meta.utm_source is None


@pytest.mark.asyncio
async def test_save_lead_syncs_notes_and_import_meta():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(id="l1")
    await repo.save_lead(
        row,
        {
            "companyName": "Acme",
            "status": "touched",
            "createdAt": "2026-07-27",
            "notes": [],
            "attachments": [],
            "importMeta": {
                "platform": "mark",
                "externalRecordId": "e1",
                "operator": {"name": "小马"},
            },
        },
    )

    added = [c.args[0] for c in db.add.call_args_list]
    metas = [x for x in added if x.__class__.__name__ == "CrmLeadImportMeta"]
    notes = [x for x in added if x.__class__.__name__ == "LeadNote"]
    assert len(notes) == 0
    assert len(metas) == 1
    assert metas[0].lead_id == "l1"
    assert metas[0].platform == "mark"
    assert metas[0].external_record_id == "e1"
    assert metas[0].operator_name == "小马"
