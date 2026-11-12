from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.release_note import ReleaseNote


class ReleaseNotesRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_version(self, version: str) -> ReleaseNote | None:
        result = await self.db.execute(select(ReleaseNote).where(ReleaseNote.version == version))
        return result.scalar_one_or_none()

    async def add(self, row: ReleaseNote) -> ReleaseNote:
        self.db.add(row)
        await self.db.flush()
        return row

    async def save(self) -> None:
        await self.db.commit()
