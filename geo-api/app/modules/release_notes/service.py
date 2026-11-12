from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.core.time_utils import china_now
from app.models.release_note import ReleaseNote
from app.modules.auth.schemas import AuthUser
from app.modules.release_notes.repository import ReleaseNotesRepository
from app.modules.release_notes.schemas import ReleaseNoteOut, UpsertReleaseNoteBody


def _to_out(row: ReleaseNote) -> ReleaseNoteOut:
    return ReleaseNoteOut(
        version=row.version,
        title=row.title,
        body=row.body,
        published_at=row.published_at.isoformat(sep=" ", timespec="seconds"),
    )


class ReleaseNotesService:
    def __init__(self, db: AsyncSession):
        self.repo = ReleaseNotesRepository(db)

    async def get_by_version(self, version: str) -> ReleaseNoteOut:
        key = (version or "").strip()
        if not key:
            raise ValidationError("version 不能为空")
        row = await self.repo.get_by_version(key)
        if row is None:
            raise NotFoundError("该版本暂无更新说明")
        return _to_out(row)

    async def upsert(self, user: AuthUser, body: UpsertReleaseNoteBody) -> ReleaseNoteOut:
        if user.role not in {"admin", "super_admin"}:
            raise PermissionDeniedError("仅管理员可维护更新说明")

        version = body.version.strip()
        title = body.title.strip()
        body_text = body.body.strip()
        if not version or not title or not body_text:
            raise ValidationError("version / title / body 不能为空")

        now = china_now()
        published_at = now
        if body.published_at:
            raw = body.published_at.strip().replace("T", " ")
            try:
                published_at = datetime.fromisoformat(raw)
            except ValueError as exc:
                raise ValidationError("publishedAt 格式无效") from exc

        existing = await self.repo.get_by_version(version)
        if existing is None:
            row = ReleaseNote(
                id=str(uuid4()),
                version=version,
                title=title,
                body=body_text,
                published_at=published_at,
                created_at=now,
                updated_at=now,
            )
            await self.repo.add(row)
        else:
            existing.title = title
            existing.body = body_text
            existing.published_at = published_at
            existing.updated_at = now
            row = existing

        await self.repo.save()
        return _to_out(row)
