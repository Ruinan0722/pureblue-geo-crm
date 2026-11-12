from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import utc_now
from app.models import CheckinRecord as CheckinRecordModel
from app.models.checkin_record import CheckinAttachment as CheckinAttachmentModel
from app.modules.checkin.attachment_store import build_attachment_db_records
from app.modules.checkin.schemas import (
    CheckinAttachment,
    CheckinRecord,
    CheckinStats,
    CheckinType,
    CheckinUserBreakdown,
)


def _parse_department_names(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def _parse_attachment_ids(raw: str | list | None) -> list[str] | None:
    if not raw:
        return None
    if isinstance(raw, list):
        return [str(item) for item in raw if item]
    try:
        parsed = json.loads(raw)
        return [str(item) for item in parsed] if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


def _parse_attachments(raw: Any, attachment_ids: list[str] | None) -> list[CheckinAttachment]:
    items: list[dict] = []
    if isinstance(raw, list):
        items = [item for item in raw if isinstance(item, dict)]
    elif isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                items = [item for item in parsed if isinstance(item, dict)]
        except json.JSONDecodeError:
            items = []

    if not items and attachment_ids:
        items = build_attachment_db_records(attachment_ids)

    result: list[CheckinAttachment] = []
    for item in items:
        attachment_id = str(item.get("id") or "").strip()
        if not attachment_id:
            continue
        result.append(
            CheckinAttachment(
                id=attachment_id,
                url=str(item.get("url") or f"/api/checkin/attachments/{attachment_id}"),
                storage_path=str(
                    item.get("storagePath")
                    or item.get("storage_path")
                    or f"data/checkin-attachments/{attachment_id}"
                ),
                original_name=(item.get("originalName") or item.get("original_name") or None),
                content_type=(item.get("contentType") or item.get("content_type") or None),
                size=item.get("size") if isinstance(item.get("size"), int) else None,
                uploaded_at=(item.get("uploadedAt") or item.get("uploaded_at") or None),
                uploaded_by=(item.get("uploadedBy") or item.get("uploaded_by") or None),
            )
        )
    return result


def _subtable_attachment_to_schema(
    item: CheckinAttachmentModel,
) -> CheckinAttachment:
    """checkin_attachments 子表行 → 响应契约。"""
    attachment_id = str(item.id or "")
    return CheckinAttachment(
        id=attachment_id,
        url=str(item.url or f"/api/checkin/attachments/{attachment_id}"),
        storage_path=str(
            item.storage_path or f"data/checkin-attachments/{attachment_id}"
        ),
        original_name=item.original_name,
        content_type=item.content_type,
        size=item.size if isinstance(item.size, int) else None,
        uploaded_at=item.uploaded_at,
        uploaded_by=item.uploaded_by,
    )


def _row_to_record(
    row: CheckinRecordModel,
    attachments: list[CheckinAttachment] | None = None,
) -> CheckinRecord:
    attachment_ids = _parse_attachment_ids(row.attachment_ids)
    if attachments is None:
        attachments = _parse_attachments(getattr(row, "attachments", None), attachment_ids)
    if not attachment_ids and attachments:
        attachment_ids = [item.id for item in attachments]
    return CheckinRecord(
        id=row.id,
        user_id=row.user_id,
        user_name=row.user_name,
        department_names=_parse_department_names(row.department_names),
        visit_id=row.visit_id,
        type=row.type,  # type: ignore[arg-type]
        timestamp=row.timestamp,
        beijing_time=row.beijing_time,
        latitude=row.latitude,
        longitude=row.longitude,
        accuracy=row.accuracy,
        address=row.address,
        province=row.province,
        city=row.city,
        district=row.district,
        attachment_ids=attachment_ids,
        attachments=attachments,
    )


class CheckinRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_all(self) -> list[CheckinRecordModel]:
        result = await self.db.execute(
            select(CheckinRecordModel).order_by(desc(CheckinRecordModel.timestamp))
        )
        return list(result.scalars().all())

    async def list_by_user(self, user_id: str) -> list[CheckinRecordModel]:
        result = await self.db.execute(
            select(CheckinRecordModel)
            .where(CheckinRecordModel.user_id == user_id)
            .order_by(desc(CheckinRecordModel.timestamp))
        )
        return list(result.scalars().all())

    async def list_by_user_ids(self, user_ids: list[str]) -> list[CheckinRecordModel]:
        if not user_ids:
            return []
        result = await self.db.execute(
            select(CheckinRecordModel)
            .where(CheckinRecordModel.user_id.in_(user_ids))
            .order_by(desc(CheckinRecordModel.timestamp))
        )
        return list(result.scalars().all())

    async def list_filtered(
        self,
        *,
        user_ids: list[str] | None,
        record_type: CheckinType | None,
        from_ts: int | None,
        to_ts: int | None,
    ) -> list[CheckinRecordModel]:
        stmt = select(CheckinRecordModel)
        if user_ids is not None:
            if not user_ids:
                return []
            stmt = stmt.where(CheckinRecordModel.user_id.in_(user_ids))
        if record_type:
            stmt = stmt.where(CheckinRecordModel.type == record_type)
        if from_ts is not None:
            stmt = stmt.where(CheckinRecordModel.timestamp >= from_ts)
        if to_ts is not None:
            stmt = stmt.where(CheckinRecordModel.timestamp <= to_ts)
        stmt = stmt.order_by(desc(CheckinRecordModel.timestamp))
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def list_checkin_attachments(
        self, checkin_ids: list[str]
    ) -> dict[str, list[CheckinAttachment]]:
        """批量读取打卡附件子表（避免列表 N+1）。"""
        ids = [str(x) for x in checkin_ids if str(x)]
        out: dict[str, list[CheckinAttachment]] = {cid: [] for cid in ids}
        if not ids:
            return out
        result = await self.db.execute(
            select(CheckinAttachmentModel)
            .where(CheckinAttachmentModel.checkin_id.in_(ids))
            .order_by(CheckinAttachmentModel.checkin_id, CheckinAttachmentModel.created_at)
        )
        for item in result.scalars().all():
            out.setdefault(item.checkin_id, []).append(
                _subtable_attachment_to_schema(item)
            )
        return out

    async def find_open_visit_id(self, user_id: str) -> str | None:
        """最近一次未配对 leave 的 arrive.visit_id。"""
        rows = await self.list_by_user(user_id)
        leave_visit_ids = {row.visit_id for row in rows if row.type == "leave"}
        for row in rows:
            if row.type == "arrive" and row.visit_id not in leave_visit_ids:
                return row.visit_id
        return None

    async def find_user_id_for_attachment(self, attachment_id: str) -> str | None:
        """定位引用该附件的打卡记录归属人（checkin_attachments 表）。"""
        aid = (attachment_id or "").strip()
        if not aid:
            return None
        from app.models.checkin_record import CheckinAttachment as CheckinAttachmentModel

        row = (
            await self.db.execute(
                select(CheckinRecordModel.user_id)
                .join(
                    CheckinAttachmentModel,
                    CheckinAttachmentModel.checkin_id == CheckinRecordModel.id,
                )
                .where(CheckinAttachmentModel.id == aid)
                .limit(1)
            )
        ).first()
        if row:
            return str(row[0])
        legacy = (
            await self.db.execute(
                select(CheckinRecordModel.user_id)
                .where(CheckinRecordModel.attachment_ids.like(f"%{aid}%"))
                .limit(1)
            )
        ).first()
        return str(legacy[0]) if legacy else None

    async def has_record_type_for_visit(
        self,
        *,
        user_id: str,
        visit_id: str,
        record_type: CheckinType,
    ) -> bool:
        result = await self.db.execute(
            select(CheckinRecordModel.id)
            .where(
                CheckinRecordModel.user_id == user_id,
                CheckinRecordModel.visit_id == visit_id,
                CheckinRecordModel.type == record_type,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def create(
        self,
        *,
        user_id: str,
        user_name: str,
        department_names: list[str],
        visit_id: str,
        record_type: CheckinType,
        timestamp: int,
        beijing_time: str,
        latitude: float,
        longitude: float,
        accuracy: float | None,
        address: str,
        province: str | None,
        city: str | None,
        district: str | None,
        attachment_ids: list[str] | None,
    ) -> CheckinRecordModel:
        attachments = build_attachment_db_records(attachment_ids)
        row = CheckinRecordModel(
            id=str(uuid.uuid4()),
            user_id=user_id,
            user_name=user_name,
            department_names=json.dumps(department_names, ensure_ascii=False),
            visit_id=visit_id,
            type=record_type,
            timestamp=timestamp,
            beijing_time=beijing_time,
            latitude=latitude,
            longitude=longitude,
            accuracy=accuracy,
            address=address,
            province=province,
            city=city,
            district=district,
            created_at=utc_now(),
        )
        self.db.add(row)
        await self.db.flush()
        for item in attachments or []:
            if not isinstance(item, dict):
                continue
            self.db.add(
                CheckinAttachmentModel(
                    id=str(item.get("id") or ""),
                    checkin_id=row.id,
                    name=str(item.get("originalName") or item.get("name") or ""),
                    url=str(item.get("url") or ""),
                    storage_path=str(item.get("storagePath") or ""),
                    content_type=str(item.get("contentType") or ""),
                    original_name=str(item.get("originalName") or ""),
                    uploaded_at=str(item.get("uploadedAt") or "") or None,
                    uploaded_by=str(item.get("uploadedBy") or "") or None,
                    size=int(item.get("size") or 0),
                    created_at=utc_now(),
                )
            )
        return row

    async def compute_stats(self, rows: list[CheckinRecordModel]) -> CheckinStats:
        arrive_count = sum(1 for r in rows if r.type == "arrive")
        leave_count = sum(1 for r in rows if r.type == "leave")
        by_user: dict[str, dict[str, Any]] = {}
        for row in rows:
            entry = by_user.setdefault(
                row.user_id,
                {"user_name": row.user_name, "count": 0, "arrive_count": 0, "leave_count": 0},
            )
            entry["count"] += 1
            if row.type == "arrive":
                entry["arrive_count"] += 1
            else:
                entry["leave_count"] += 1

        breakdown = [
            CheckinUserBreakdown(
                user_id=uid,
                user_name=data["user_name"],
                count=data["count"],
                arrive_count=data["arrive_count"],
                leave_count=data["leave_count"],
            )
            for uid, data in sorted(by_user.items(), key=lambda item: (-item[1]["count"], item[1]["user_name"]))
        ]

        return CheckinStats(
            total=len(rows),
            arrive_count=arrive_count,
            leave_count=leave_count,
            unique_users=len(by_user),
            user_breakdown=breakdown,
        )
