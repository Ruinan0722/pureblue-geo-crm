"""Mark upsert：未携带集合时不得抹掉既有 notes/attachments。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.mark_integration.schemas import UnifiedLeadEvent
from app.modules.mark_integration.service import MarkIntegrationService


class _FakeDb:
    def __init__(self):
        self.added = []
        self.commit = AsyncMock()
        self.rollback = AsyncMock()

    def add(self, value):
        self.added.append(value)


@pytest.mark.asyncio
async def test_mark_upsert_preserves_lead_notes_and_attachments():
    notes = [{"id": "n1", "content": "keep", "author": "a", "date": "2026-08-01"}]
    attachments = [{"id": "a1", "name": "f.pdf", "size": 12}]
    old_meta = {"platform": "mark", "externalRecordId": "MARK-1", "source": "integration"}

    db = _FakeDb()
    service = MarkIntegrationService(db)  # type: ignore[arg-type]
    service.repo.get_event = AsyncMock(return_value=None)
    service.repo.get_record = AsyncMock(
        return_value=SimpleNamespace(
            crm_lead_id="l-1",
            last_event_id="evt-old",
            updated_at=None,
        )
    )
    lead = SimpleNamespace(
        id="l-1",
        document={
            "id": "l-1",
            "companyName": "旧公司",
            "contactName": "旧联系人",
            "email": "old@example.com",
        },
    )
    service.repo.get_lead = AsyncMock(return_value=lead)
    service.crm_repo.get_lead_children = AsyncMock(
        return_value={
            "notes": list(notes),
            "attachments": list(attachments),
            "importMeta": dict(old_meta),
        }
    )
    saved: list[dict] = []

    async def fake_save(row, document):
        saved.append(dict(document))
        row.document = document
        return row

    service.crm_repo.save_lead = AsyncMock(side_effect=fake_save)

    body = UnifiedLeadEvent.model_validate(
        {
            "eventId": "evt-upsert-1",
            "eventType": "lead.created",
            "externalRecordId": "MARK-1",
            "occurredAt": "2026-08-08T10:00:00+08:00",
            "data": {
                "companyName": "新公司",
                "contactName": "新联系人",
                "contactPhone": "13900139000",
                "email": "new@example.com",
            },
        }
    )
    result = await service.receive_lead("mark", body)
    assert result.created is False
    assert saved, "应 save_lead"
    assert saved[0]["notes"] == notes
    assert saved[0]["attachments"] == attachments
    assert saved[0]["companyName"] == "新公司"
    assert saved[0]["importMeta"]["platform"] == "mark"
    assert saved[0]["importMeta"]["externalRecordId"] == "MARK-1"
    assert saved[0]["importMeta"]["lastEventId"] == "evt-upsert-1"
