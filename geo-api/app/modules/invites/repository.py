from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import format_legacy_time, utc_now
from app.models import Invite, User
from app.modules.invites.schemas import InviteRecord


def _dt_to_str(value: datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return format_legacy_time(value)


def _row_to_invite(
    row: Invite,
    *,
    url: str | None = None,
    staff_name: str | None = None,
    include_secrets: bool = True,
) -> InviteRecord:
    """列表/详情默认返回完整 token 与 url（产品要求不做脱敏）。"""
    variant = getattr(row, "geo_variant", None) or "overseas"
    if variant not in ("overseas", "domestic"):
        variant = "overseas"
    return InviteRecord(
        id=row.id,
        token=row.token if include_secrets else None,
        staff_user_id=row.staff_user_id,
        staff_name=staff_name,
        label=row.label,
        geo_variant=variant,  # type: ignore[arg-type]
        revoked_at=_dt_to_str(row.revoked_at),
        visit_count=row.visit_count,
        created_at=_dt_to_str(row.created_at) or "",
        url=url if include_secrets else None,
        active=row.revoked_at is None,
        is_fixed=bool(getattr(row, "is_fixed", False)),
    )


class InviteRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_token(self, token: str) -> Invite | None:
        result = await self.db.execute(select(Invite).where(Invite.token == token))
        return result.scalar_one_or_none()

    async def get_by_token_for_update(self, token: str) -> Invite | None:
        """提交时行锁邀请：串行化同一链接上的并发写入，配合短时内容去重防双写。"""
        result = await self.db.execute(
            select(Invite).where(Invite.token == token).with_for_update()
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, invite_id: str) -> Invite | None:
        result = await self.db.execute(select(Invite).where(Invite.id == invite_id))
        return result.scalar_one_or_none()

    async def get_by_ids(self, invite_ids: list[str]) -> dict[str, Invite]:
        if not invite_ids:
            return {}
        result = await self.db.execute(select(Invite).where(Invite.id.in_(invite_ids)))
        return {row.id: row for row in result.scalars().all()}

    async def list_fixed_by_staff(self, staff_user_id: str) -> list[Invite]:
        result = await self.db.execute(
            select(Invite)
            .where(Invite.staff_user_id == staff_user_id, Invite.is_fixed.is_(True))
            .order_by(Invite.created_at.asc())
        )
        return list(result.scalars().all())

    async def get_fixed(self, staff_user_id: str, geo_variant: str) -> Invite | None:
        result = await self.db.execute(
            select(Invite).where(
                Invite.staff_user_id == staff_user_id,
                Invite.geo_variant == geo_variant,
                Invite.is_fixed.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def create_fixed(
        self,
        staff_user_id: str,
        token: str,
        *,
        geo_variant: str = "overseas",
    ) -> Invite:
        variant = geo_variant if geo_variant in ("overseas", "domestic") else "overseas"
        row = Invite(
            id=str(uuid.uuid4()),
            token=token,
            staff_user_id=staff_user_id,
            label=None,
            geo_variant=variant,
            is_fixed=True,
            revoked_at=None,
            visit_count=0,
            created_at=utc_now(),
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def reactivate_fixed(self, invite_id: str) -> Invite | None:
        """确定性 token 已存在（如迁移/重置残留）时，将其恢复为固定链接而非新建。"""
        await self.db.execute(
            update(Invite)
            .where(Invite.id == invite_id)
            .values(is_fixed=True, revoked_at=None)
        )
        return await self.get_by_id(invite_id)

    async def increment_visit(self, token: str) -> None:
        await self.db.execute(
            update(Invite).where(Invite.token == token).values(visit_count=Invite.visit_count + 1)
        )

    async def get_staff_name(self, staff_user_id: str) -> str | None:
        result = await self.db.execute(select(User.name).where(User.id == staff_user_id))
        return result.scalar_one_or_none()

    async def get_staff_names(self, staff_user_ids: list[str]) -> dict[str, str | None]:
        ids = [x for x in dict.fromkeys(staff_user_ids) if x]
        if not ids:
            return {}
        result = await self.db.execute(select(User.id, User.name).where(User.id.in_(ids)))
        return {str(row[0]): row[1] for row in result.all()}
