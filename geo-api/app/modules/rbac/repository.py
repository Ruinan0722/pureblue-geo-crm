"""RBAC 表仓储：所有 rbac_* / user_role_assignments / user_permission_overrides 读写。"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rbac import (
    RbacDepartmentRule,
    RbacPermission,
    RbacRole,
    RbacRolePermission,
    UserPermissionOverride,
    UserRoleAssignment,
)


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:16]}"


class RbacRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    # —— 权限目录 ——
    async def list_permissions(self) -> Sequence[RbacPermission]:
        stmt = select(RbacPermission).order_by(RbacPermission.sort_order, RbacPermission.code)
        return (await self.db.execute(stmt)).scalars().all()

    async def valid_permission_codes(self) -> set[str]:
        rows = (await self.db.execute(select(RbacPermission.code))).scalars().all()
        return set(rows)

    async def sync_permission_catalog(self, catalog: dict[str, str]) -> None:
        existing = {(p.code, p.name, p.module, p.sort_order) for p in await self.list_permissions()}
        existing_codes = {code for code, _name, _module, _sort_order in existing}
        now = _now()
        module_of = _permission_module
        for sort_order, (code, name) in enumerate(catalog.items(), start=1):
            if code in existing_codes:
                row = (await self.db.execute(select(RbacPermission).where(RbacPermission.code == code))).scalar_one()
                row.name = name
                row.module = module_of(code)
                row.sort_order = sort_order
                row.updated_at = now
            else:
                self.db.add(
                    RbacPermission(
                        code=code,
                        name=name,
                        module=module_of(code),
                        sort_order=sort_order,
                        created_at=now,
                        updated_at=now,
                    )
                )

    # —— 角色 ——
    async def list_roles(self) -> Sequence[RbacRole]:
        stmt = select(RbacRole).order_by(RbacRole.sort_order, RbacRole.name)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_role(self, role_id: str) -> RbacRole | None:
        return (
            await self.db.execute(select(RbacRole).where(RbacRole.id == role_id))
        ).scalar_one_or_none()

    async def get_role_by_code(self, code: str) -> RbacRole | None:
        return (
            await self.db.execute(select(RbacRole).where(RbacRole.code == code))
        ).scalar_one_or_none()

    async def role_permissions(self, role_id: str) -> list[str]:
        rows = (
            await self.db.execute(
                select(RbacRolePermission.permission_code)
                .where(RbacRolePermission.role_id == role_id)
                .order_by(RbacRolePermission.permission_code)
            )
        ).scalars().all()
        return list(rows)

    async def set_role_permissions(self, role_id: str, permissions: Sequence[str]) -> None:
        await self.db.execute(delete(RbacRolePermission).where(RbacRolePermission.role_id == role_id))
        for code in permissions:
            self.db.add(RbacRolePermission(role_id=role_id, permission_code=code))

    async def create_role(
        self,
        *,
        code: str,
        name: str,
        description: str,
        data_scope: str,
        permissions: Sequence[str],
    ) -> RbacRole:
        max_sort = (
            await self.db.execute(select(func.coalesce(func.max(RbacRole.sort_order), 0)))
        ).scalar_one()
        now = _now()
        role = RbacRole(
            id=new_id("role-"),
            code=code,
            name=name,
            description=description,
            data_scope=data_scope,
            is_system=False,
            sort_order=int(max_sort or 0) + 1,
            created_at=now,
            updated_at=now,
        )
        self.db.add(role)
        await self.db.flush()
        if permissions:
            await self.set_role_permissions(role.id, permissions)
        return role

    async def update_role_fields(self, role_id: str, fields: dict[str, Any]) -> None:
        if not fields:
            return
        fields = dict(fields)
        fields["updated_at"] = _now()
        await self.db.execute(update(RbacRole).where(RbacRole.id == role_id).values(**fields))

    async def delete_role(self, role_id: str) -> None:
        await self.db.execute(delete(RbacRolePermission).where(RbacRolePermission.role_id == role_id))
        await self.db.execute(delete(RbacRole).where(RbacRole.id == role_id))

    async def count_role_assignments(self, role_id: str) -> int:
        return int(
            (
                await self.db.execute(
                    select(func.count())
                    .select_from(UserRoleAssignment)
                    .where(UserRoleAssignment.role_id == role_id)
                )
            ).scalar_one()
            or 0
        )

    # —— 部门规则 ——
    async def list_department_rules(self) -> Sequence[RbacDepartmentRule]:
        stmt = select(RbacDepartmentRule).order_by(
            RbacDepartmentRule.sort_order, RbacDepartmentRule.department_name
        )
        return (await self.db.execute(stmt)).scalars().all()

    async def replace_department_rules(self, rules: Sequence[tuple[str, str, int]]) -> None:
        await self.db.execute(delete(RbacDepartmentRule))
        for department_name, role_code, sort_order in rules:
            self.db.add(
                RbacDepartmentRule(
                    department_name=department_name,
                    role_code=role_code,
                    sort_order=sort_order,
                )
            )

    async def ensure_department_rules(self, rules: Sequence[tuple[str, str, int]]) -> None:
        existing = {
            (r.department_name, r.role_code) for r in await self.list_department_rules()
        }
        for department_name, role_code, sort_order in rules:
            if (department_name, role_code) in existing:
                continue
            self.db.add(
                RbacDepartmentRule(
                    department_name=department_name,
                    role_code=role_code,
                    sort_order=sort_order,
                )
            )

    # —— 用户角色/覆盖 ——
    async def user_assignments(self, user_id: str) -> Sequence[UserRoleAssignment]:
        stmt = select(UserRoleAssignment).where(UserRoleAssignment.user_id == user_id)
        return (await self.db.execute(stmt)).scalars().all()

    async def set_user_single_role(self, user_id: str, role_id: str, role_code: str) -> None:
        now = _now()
        await self.db.execute(delete(UserRoleAssignment).where(UserRoleAssignment.user_id == user_id))
        self.db.add(
            UserRoleAssignment(
                user_id=user_id,
                role_id=role_id,
                is_primary=True,
                assigned_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        await self.db.execute(
            text("UPDATE users SET role = :role, updated_at = :ts WHERE id = :uid"),
            {"role": role_code, "ts": now, "uid": user_id},
        )

    async def clear_user_roles(self, user_id: str) -> None:
        await self.db.execute(delete(UserRoleAssignment).where(UserRoleAssignment.user_id == user_id))

    async def user_overrides(self, user_id: str) -> Sequence[UserPermissionOverride]:
        stmt = select(UserPermissionOverride).where(UserPermissionOverride.user_id == user_id)
        return (await self.db.execute(stmt)).scalars().all()

    async def replace_user_overrides(
        self, user_id: str, overrides: Sequence[tuple[str, bool]]
    ) -> None:
        now = _now()
        await self.db.execute(
            delete(UserPermissionOverride).where(UserPermissionOverride.user_id == user_id)
        )
        for code, granted in overrides:
            self.db.add(
                UserPermissionOverride(
                    user_id=user_id,
                    permission_code=code,
                    granted=granted,
                    created_at=now,
                    updated_at=now,
                )
            )

    async def set_user_flag(self, user_id: str, **fields: Any) -> None:
        fields["updated_at"] = _now()
        keys = ", ".join(f"{k} = :{k}" for k in fields)
        params = {**fields, "uid": user_id}
        await self.db.execute(
            text(f"UPDATE users SET {keys} WHERE id = :uid"),
            params,
        )

    async def multi_role_user_ids(self) -> list[str]:
        rows = (
            await self.db.execute(
                text(
                    "SELECT user_id FROM user_role_assignments "
                    "GROUP BY user_id HAVING COUNT(*) > 1"
                )
            )
        ).scalars().all()
        return list(rows)


def _permission_module(code: str) -> str:
    if code.startswith("section:"):
        return "导航"
    if code.startswith(
        ("leads:", "lead_source_options:", "customers:", "opportunities:", "contracts:", "projects:")
    ):
        return "CRM"
    prefix = code.split(":")[0]
    return {"request": "需求单", "invite": "邀请链接", "checkin": "打卡"}.get(prefix, "其他")
