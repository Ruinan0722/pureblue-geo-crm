"""打卡序列化读路径：_row_to_record 从 checkin_attachments 子表批量组装（契约保持）。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.checkin.repository import CheckinRepository, _row_to_record
from app.modules.checkin.schemas import CheckinAttachment


def _row():
    return SimpleNamespace(
        id="c1",
        user_id="u1",
        user_name="张三",
        department_names='["销售部"]',
        visit_id="v1",
        type="arrive",
        timestamp=123,
        beijing_time="2026-08-07 10:00",
        latitude=1.0,
        longitude=2.0,
        accuracy=None,
        address="地址",
        province="省",
        city="市",
        district="区",
        attachment_ids='["a1"]',
        attachments=[
            {
                "id": "a1",
                "url": "/api/checkin/attachments/a1",
                "storagePath": "data/checkin-attachments/a1",
                "originalName": "photo.jpg",
                "contentType": "image/jpeg",
                "size": 1024,
                "uploadedAt": "2026-08-07T08:00:00",
                "uploadedBy": "u1",
            }
        ],
    )


def test_row_to_record_subtable_matches_json_contract():
    row = _row()
    json_rec = _row_to_record(row)
    sub_attachment = CheckinAttachment(
        id="a1",
        url="/api/checkin/attachments/a1",
        storage_path="data/checkin-attachments/a1",
        original_name="photo.jpg",
        content_type="image/jpeg",
        size=1024,
        uploaded_at="2026-08-07T08:00:00",
        uploaded_by="u1",
    )
    sub_rec = _row_to_record(row, [sub_attachment])
    assert [a.model_dump() for a in sub_rec.attachments] == [
        a.model_dump() for a in json_rec.attachments
    ]
    assert sub_rec.attachment_ids == ["a1"]
    assert sub_rec.id == "c1"


@pytest.mark.asyncio
async def test_list_checkin_attachments_assembles():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CheckinRepository(db)
    att_row = SimpleNamespace(
        id="a1",
        checkin_id="c1",
        name="photo.jpg",
        url="/api/checkin/attachments/a1",
        storage_path="data/checkin-attachments/a1",
        content_type="image/jpeg",
        original_name="photo.jpg",
        uploaded_at="2026-08-07T08:00:00",
        uploaded_by="u1",
        size=1024,
    )
    db.execute.return_value = SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: [att_row])
    )
    out = await repo.list_checkin_attachments(["c1"])
    assert len(out["c1"]) == 1
    att = out["c1"][0]
    assert att.id == "a1"
    assert att.url == "/api/checkin/attachments/a1"
    assert att.original_name == "photo.jpg"
    assert att.uploaded_at == "2026-08-07T08:00:00"
    assert att.uploaded_by == "u1"
    assert att.size == 1024


@pytest.mark.asyncio
async def test_create_writes_full_subtable_columns(monkeypatch):
    db = AsyncMock()
    db.add = MagicMock()
    repo = CheckinRepository(db)
    rich = [
        {
            "id": "a1",
            "url": "/api/checkin/attachments/a1",
            "storagePath": "data/checkin-attachments/a1",
            "originalName": "photo.jpg",
            "contentType": "image/jpeg",
            "size": 1024,
            "uploadedAt": "2026-08-07T08:00:00",
            "uploadedBy": "u1",
        }
    ]
    monkeypatch.setattr(
        "app.modules.checkin.repository.build_attachment_db_records",
        lambda _ids: rich,
    )
    await repo.create(
        user_id="u1",
        user_name="张三",
        department_names=["销售部"],
        visit_id="v1",
        record_type="arrive",
        timestamp=123,
        beijing_time="2026-08-07 10:00",
        latitude=1.0,
        longitude=2.0,
        accuracy=None,
        address="地址",
        province="省",
        city="市",
        district="区",
        attachment_ids=["a1"],
    )
    added = [c.args[0] for c in db.add.call_args_list]
    att = next(x for x in added if x.__class__.__name__ == "CheckinAttachment")
    assert att.checkin_id == "c1" or att.checkin_id
    assert att.name == "photo.jpg"
    assert att.original_name == "photo.jpg"
    assert att.uploaded_at == "2026-08-07T08:00:00"
    assert att.uploaded_by == "u1"
    assert att.size == 1024
