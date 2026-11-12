"""溯源字段：sync_attachments / coverage follow-up 写穿 origin。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.crm.repository.base import sync_attachments


@pytest.mark.asyncio
async def test_sync_attachments_persists_provenance():
    db = AsyncMock()
    db.add = MagicMock()
    await sync_attachments(
        db,
        "opportunity",
        "o1",
        [
            {
                "id": "f1",
                "name": "需求.pdf",
                "size": 1,
                "origin": "request",
                "sourceRequestId": "r1",
                "sourceRequestAttachmentId": "ra1",
            }
        ],
    )
    added = [c.args[0] for c in db.add.call_args_list]
    assert len(added) == 1
    row = added[0]
    assert row.origin == "request"
    assert row.source_request_id == "r1"
    assert row.source_request_attachment_id == "ra1"
