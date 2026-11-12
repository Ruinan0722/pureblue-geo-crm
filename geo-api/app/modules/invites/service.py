"""邀请链接：每人固定国内/海外各一条，自动配发，不可撤销/删除。

产品决策（2026-08）：
- 销售无需手动生成链接，登录后自动拥有固定链接（国内一条 + 海外一条）；
- 海外运营仅海外一条；token 由确定性规则生成，链接永久稳定；
- 固定链接不提供撤销/删除；不再提供「查看全部销售链接」。
"""

from __future__ import annotations

import logging

from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.deps import user_has_permission
from app.core.exceptions import PermissionDeniedError
from app.modules.auth.schemas import AuthUser
from app.modules.invites.repository import InviteRepository, _row_to_invite
from app.modules.invites.schemas import InviteListResponse, InviteRecord, ResolveInviteResponse

logger = logging.getLogger(__name__)


class InviteService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = InviteRepository(db)
        self.settings = get_settings()

    def _portal_url(self, token: str, *, geo_variant: str = "overseas") -> str:
        base = self.settings.customer_portal_url.rstrip("/")
        if geo_variant == "domestic":
            # 路径编码变体，避免 ?v=cn 被复制/转发时丢掉后误进海外表单
            return f"{base}/c/cn/{token}"
        return f"{base}/c/{token}"

    def _url_for_invite(self, invite) -> str:
        variant = getattr(invite, "geo_variant", None) or "overseas"
        return self._portal_url(invite.token, geo_variant=variant)

    def _fixed_token(self, staff_user_id: str, geo_variant: str) -> str:
        """确定性 token：同一销售同一变体永远得到同一个链接。"""
        return f"staff-{staff_user_id}-{geo_variant}"

    def _fixed_variants(self, user: AuthUser) -> list[str]:
        from app.core.geo_scope import forced_geo_source

        if forced_geo_source(user) == "overseas":
            return ["overseas"]
        return ["overseas", "domestic"]

    async def ensure_fixed_invites(self, user: AuthUser) -> list[InviteRecord]:
        """自动配发固定链接：每人国内/海外各一条（海外运营仅海外），token 稳定。"""
        # 快速切换用户 / Strict Mode 双请求时，多个请求可能同时 INSERT 同一确定性 token。
        # 单条用 savepoint 消化冲突；整批仍保留一次重试兜底。
        for attempt in range(2):
            try:
                rows = []
                for variant in self._fixed_variants(user):
                    rows.append(await self._ensure_one_fixed(user, variant))
                await self.db.commit()
                return [
                    _row_to_invite(
                        row,
                        url=self._url_for_invite(row),
                        staff_name=user.name,
                        include_secrets=True,
                    )
                    for row in rows
                ]
            except (IntegrityError, OperationalError):
                await self.db.rollback()
                if attempt == 0:
                    continue
                raise

    async def _ensure_one_fixed(self, user: AuthUser, variant: str):
        row = await self.repo.get_fixed(user.id, variant)
        if row is not None:
            return row
        token = self._fixed_token(user.id, variant)
        existing = await self.repo.get_by_token(token)
        if existing is not None:
            # 确定性 token 冲突（迁移/重置残留）：复活旧行，避免唯一约束冲突
            return await self.repo.reactivate_fixed(existing.id) or existing
        try:
            async with self.db.begin_nested():
                return await self.repo.create_fixed(
                    user.id,
                    token,
                    geo_variant=variant,
                )
        except IntegrityError:
            # 并发请求已插入同一 token：savepoint 回滚后按 token 复用，不污染外层事务
            existing = await self.repo.get_by_token(token)
            if existing is not None:
                return await self.repo.reactivate_fixed(existing.id) or existing
            row = await self.repo.get_fixed(user.id, variant)
            if row is not None:
                return row
            raise

    async def list_for_user(self, user: AuthUser) -> InviteListResponse:
        """仅返回本人固定链接（销售/管理员都只看自己的；不再支持查看全部）。"""
        if not user_has_permission(user, "invite:manage"):
            raise PermissionDeniedError("无权限查看邀请链接")
        return InviteListResponse(invites=await self.ensure_fixed_invites(user))

    async def resolve(self, token: str, *, count_visit: bool = False) -> ResolveInviteResponse:
        invite = await self.repo.get_by_token(token)
        if not invite:
            return ResolveInviteResponse(valid=False, reason="invalid")
        variant = getattr(invite, "geo_variant", None) or "overseas"
        if variant not in ("overseas", "domestic"):
            variant = "overseas"
        if invite.revoked_at:
            return ResolveInviteResponse(valid=False, reason="revoked", geo_variant=variant)  # type: ignore[arg-type]
        if count_visit:
            await self.repo.increment_visit(token)
        await self.db.commit()
        name = await self.repo.get_staff_name(invite.staff_user_id)
        return ResolveInviteResponse(valid=True, staff_name=name, geo_variant=variant)  # type: ignore[arg-type]
