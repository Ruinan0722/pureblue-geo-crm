"""联系人/跟进独立表：写穿同步（create/save coverage → crm_contacts / crm_follow_ups）。"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.crm.repository import CrmRepository


def _coverage(document: dict) -> SimpleNamespace:
    return SimpleNamespace(
        id="cv-1",
        customer_id="c-1",
        document=document,
    )


@pytest.mark.asyncio
async def test_sync_coverage_child_rows_writes_contacts_and_followups():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    coverage = _coverage(
        {
            "contacts": [
                {
                    "id": "ct-1",
                    "name": "王女士",
                    "title": "经理",
                    "phone": "13800000000",
                    "wechat": "wx",
                    "email": "a@b.com",
                    "status": "connected",
                    "isPrimary": True,
                    "active": True,
                    "wechatAdded": True,
                    "source": "自拓",
                }
            ],
            "notes": [
                {
                    "id": "note-1",
                    "author": "销售A",
                    "content": "已沟通",
                    "followType": "phone",
                    "contactId": "ct-1",
                    "contactName": "王女士",
                    "origin": "lead",
                    "sourceLeadId": "l-1",
                    "sourceLeadNoteId": "ln-1",
                    "wechatAdded": False,
                    "mentions": ["张三"],
                    "nextFollowAt": "2026-08-10 10:00",
                    "date": "2026-08-01 09:00",
                }
            ],
            "attachments": [],
        }
    )

    await repo._sync_coverage_child_rows(coverage)

    added = [c.args[0] for c in db.add.call_args_list]
    contacts = [x for x in added if x.__class__.__name__ == "CrmContact"]
    follow_ups = [x for x in added if x.__class__.__name__ == "CrmFollowUp"]
    assert len(contacts) == 1
    assert len(follow_ups) == 1
    contact = contacts[0]
    assert contact.coverage_id == "cv-1"
    assert contact.id == "ct-1"
    assert contact.name == "王女士"
    assert contact.status == "connected"
    assert contact.is_primary is True
    assert contact.wechat_added is True
    follow = follow_ups[0]
    assert follow.id == "note-1"
    assert follow.author == "销售A"
    assert follow.follow_type == "phone"
    assert follow.contact_id == "ct-1"
    assert follow.contact_name == "王女士"
    assert follow.origin == "lead"
    assert follow.source_lead_id == "l-1"
    assert follow.source_lead_note_id == "ln-1"
    assert follow.mentions == '["张三"]'
    assert follow.next_follow_at == datetime(2026, 8, 10).date()
    assert follow.created_at == datetime(2026, 8, 1, 9, 0)


@pytest.mark.asyncio
async def test_sync_coverage_child_rows_requires_collection_keys():
    from app.core.exceptions import ValidationError

    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    with pytest.raises(ValidationError, match="attachments"):
        await repo._sync_coverage_child_rows(
            _coverage({"contacts": [], "notes": []})
        )
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_sync_coverage_child_rows_clears_old_rows():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    await repo._sync_coverage_child_rows(
        _coverage({"contacts": [], "notes": [], "attachments": []})
    )
    db.execute.assert_awaited()
