from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.modules.auth.auth_cache import resolve_user_auth
from app.modules.auth.schemas import AuthUser


class AuthRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_auth_user_by_id(self, user_id: str) -> AuthUser | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            return None
        return await self._to_auth_user(user)

    async def _to_auth_user(self, user: User) -> AuthUser:
        dept = user.department_names if isinstance(user.department_names, list) else []
        override = getattr(user, "data_scope_override", None)
        role, permissions, data_scope = await resolve_user_auth(
            self.db,
            user_id=user.id,
            fallback_role=user.role,
            data_scope_override=override,
        )
        role_rows = (
            await self.db.execute(
                text(
                    """
                    SELECT r.code AS role_code, r.name AS role_name
                    FROM user_role_assignments ura
                    JOIN rbac_roles r ON r.id = ura.role_id
                    WHERE ura.user_id = :user_id
                    ORDER BY ura.is_primary DESC, r.sort_order
                    """
                ),
                {"user_id": user.id},
            )
        ).mappings().all()
        role_codes = [str(row["role_code"]) for row in role_rows]
        role_label = (
            str(role_rows[0]["role_name"])
            if role_rows and str(role_rows[0]["role_name"])
            else await self._role_display_name(role) or role
        )
        return AuthUser(
            id=user.id,
            feishu_open_id=user.feishu_open_id,
            name=user.name,
            avatar_url=user.avatar_url,
            role=role,
            role_label=role_label,
            roles=role_codes or [role],
            permissions=permissions,
            data_scope=data_scope,
            department_names=dept,
            role_source=user.role_source or "feishu",
            role_locked=bool(user.role_locked),
            manual_department_open_id=user.manual_department_open_id,
            manual_department_name=user.manual_department_name,
            manual_department_note=user.manual_department_note,
            manual_department_leader=bool(user.manual_department_leader),
            feishu_led_department_ids=(
                list(user.feishu_led_department_ids)
                if isinstance(user.feishu_led_department_ids, list)
                else []
            ),
        )

    async def _role_display_name(self, role_code: str) -> str | None:
        """无 user_role_assignments（dev 占位 / 回退身份）时按角色 code 取 rbac_roles 展示名。"""
        row = (
            await self.db.execute(
                text("SELECT name FROM rbac_roles WHERE code = :code LIMIT 1"),
                {"code": role_code},
            )
        ).mappings().first()
        name = str(row["name"]).strip() if row and row["name"] else ""
        return name or None
