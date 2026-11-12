from __future__ import annotations

import inspect

from sqlalchemy import desc, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CrmLead
from app.modules.mark_integration.models import (
    MarkIntegrationEvent,
    MarkIntegrationFile,
    MarkIntegrationRecord,
    MarkReviewCallback,
)


class MarkIntegrationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_event(self, platform: str, event_id: str) -> MarkIntegrationEvent | None:
        result = await self.db.execute(
            select(MarkIntegrationEvent).where(
                MarkIntegrationEvent.platform == platform,
                MarkIntegrationEvent.event_id == event_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_record(
        self, platform: str, external_record_id: str
    ) -> MarkIntegrationRecord | None:
        result = await self.db.execute(
            select(MarkIntegrationRecord).where(
                MarkIntegrationRecord.platform == platform,
                MarkIntegrationRecord.external_record_id == external_record_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_lead(self, lead_id: str) -> CrmLead | None:
        result = await self.db.execute(select(CrmLead).where(CrmLead.id == lead_id))
        return result.scalar_one_or_none()

    async def get_record_by_lead(self, platform: str, lead_id: str) -> MarkIntegrationRecord | None:
        result = await self.db.execute(
            select(MarkIntegrationRecord).where(
                MarkIntegrationRecord.platform == platform,
                MarkIntegrationRecord.crm_lead_id == lead_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_file(
        self,
        platform: str,
        external_record_id: str,
        *,
        file_id: str | None = None,
        version: str | None = None,
    ) -> MarkIntegrationFile | None:
        stmt = select(MarkIntegrationFile).where(
            MarkIntegrationFile.platform == platform,
            MarkIntegrationFile.external_record_id == external_record_id,
        )
        if file_id:
            stmt = stmt.where(MarkIntegrationFile.id == file_id)
        if version:
            stmt = stmt.where(MarkIntegrationFile.file_version == version)
        if not file_id and not version:
            stmt = stmt.where(MarkIntegrationFile.is_current.is_(True)).order_by(
                desc(MarkIntegrationFile.uploaded_at)
            )
        result = await self.db.execute(stmt.limit(1))
        return result.scalar_one_or_none()

    async def get_file_by_id(self, file_id: str) -> MarkIntegrationFile | None:
        result = await self.db.execute(
            select(MarkIntegrationFile).where(MarkIntegrationFile.id == file_id)
        )
        return result.scalar_one_or_none()

    async def list_files_by_lead(self, lead_id: str) -> list[MarkIntegrationFile]:
        result = await self.db.execute(
            select(MarkIntegrationFile)
            .where(
                MarkIntegrationFile.platform == "mark",
                MarkIntegrationFile.crm_lead_id == lead_id,
            )
            .order_by(desc(MarkIntegrationFile.generated_at), desc(MarkIntegrationFile.uploaded_at))
        )
        scalars = result.scalars()
        if inspect.isawaitable(scalars):  # 兼容异步仓库替身/测试桩
            scalars = await scalars
        rows = scalars.all()
        if inspect.isawaitable(rows):
            rows = await rows
        return list(rows)

    async def mark_files_not_current(self, platform: str, external_record_id: str) -> None:
        await self.db.execute(
            update(MarkIntegrationFile)
            .where(
                MarkIntegrationFile.platform == platform,
                MarkIntegrationFile.external_record_id == external_record_id,
                MarkIntegrationFile.is_current.is_(True),
            )
            .values(is_current=False)
        )

    async def list_recoverable_files(self, now, *, limit: int, max_attempts: int):
        result = await self.db.execute(
            select(MarkIntegrationFile)
            .where(
                MarkIntegrationFile.download_status.in_(
                    ["pending_download", "download_failed", "downloading"]
                ),
                MarkIntegrationFile.download_attempts < max_attempts,
                or_(
                    MarkIntegrationFile.next_attempt_at.is_(None),
                    MarkIntegrationFile.next_attempt_at <= now,
                ),
            )
            .order_by(MarkIntegrationFile.download_attempts, MarkIntegrationFile.generated_at)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_due_callbacks(self, now, *, limit: int, max_attempts: int):
        result = await self.db.execute(
            select(MarkReviewCallback)
            .where(
                MarkReviewCallback.status.in_(["pending", "failed", "sending"]),
                MarkReviewCallback.attempts < max_attempts,
                MarkReviewCallback.next_attempt_at <= now,
            )
            .order_by(MarkReviewCallback.next_attempt_at)
            .limit(limit)
        )
        return list(result.scalars().all())
