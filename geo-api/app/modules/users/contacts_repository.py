from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import utc_now
from app.models import FeishuSalesContact


class ContactsRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_active_sales_contacts(self) -> list[FeishuSalesContact]:
        result = await self.db.execute(
            select(FeishuSalesContact)
            .where(FeishuSalesContact.is_active.is_(True))
            .order_by(FeishuSalesContact.name)
        )
        return list(result.scalars().all())

    async def upsert_contact(
        self,
        *,
        feishu_open_id: str,
        name: str,
        department_ids: list[str] | None,
        department_names: list[str] | None = None,
        job_title: str | None = None,
        synced_at: datetime,
    ) -> None:
        now = utc_now()
        existing = await self.db.get(FeishuSalesContact, feishu_open_id)
        if existing:
            existing.name = name
            existing.department_ids = department_ids
            existing.department_names = department_names
            existing.job_title = job_title
            existing.is_active = True
            existing.synced_at = synced_at
            existing.updated_at = now
            return

        self.db.add(
            FeishuSalesContact(
                feishu_open_id=feishu_open_id,
                name=name,
                job_title=job_title,
                department_ids=department_ids,
                department_names=department_names,
                is_active=True,
                synced_at=synced_at,
                created_at=now,
                updated_at=now,
            )
        )

    async def deactivate_missing(self, active_open_ids: set[str], synced_at: datetime) -> int:
        result = await self.db.execute(select(FeishuSalesContact).where(FeishuSalesContact.is_active.is_(True)))
        rows = list(result.scalars().all())
        count = 0
        for row in rows:
            if row.feishu_open_id not in active_open_ids:
                row.is_active = False
                row.synced_at = synced_at
                row.updated_at = utc_now()
                count += 1
        return count
