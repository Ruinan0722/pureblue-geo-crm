"""Resolve effective permissions and data scope from MySQL RBAC tables."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.permissions import (
    ROLE_DATA_SCOPE,
    ROLE_PERMISSIONS,
    normalize_role,
)
from app.modules.auth.role_privilege import pick_highest_privilege_role

DATA_SCOPE_RANK = {"own": 1, "department": 2, "all": 3}


def _normalize_role_code(raw: str) -> str:
    return "sales" if raw == "staff" else raw


def _max_data_scope(scopes: list[str]) -> str:
    if not scopes:
        return "own"
    return max(scopes, key=lambda s: DATA_SCOPE_RANK.get(s, 0))


async def _load_role_from_db(
    db: AsyncSession,
    role_code: str,
) -> tuple[list[str], str] | None:
    row = (
        await db.execute(
            text("SELECT id, data_scope FROM rbac_roles WHERE code = :code LIMIT 1"),
            {"code": role_code},
        )
    ).mappings().first()
    if not row:
        return None
    perm_rows = (
        await db.execute(
            text("SELECT permission_code FROM rbac_role_permissions WHERE role_id = :role_id"),
            {"role_id": row["id"]},
        )
    ).all()
    permissions = sorted({perm for (perm,) in perm_rows})
    data_scope = row["data_scope"] or "own"
    return permissions, data_scope


async def _apply_permission_overrides(
    db: AsyncSession,
    user_id: str,
    permission_set: set[str],
) -> None:
    override_rows = (
        await db.execute(
            text(
                """
                SELECT permission_code, granted
                FROM user_permission_overrides
                WHERE user_id = :user_id
                """
            ),
            {"user_id": user_id},
        )
    ).all()
    for perm, granted in override_rows:
        if granted:
            permission_set.add(perm)
        else:
            permission_set.discard(perm)


async def resolve_user_auth(
    db: AsyncSession,
    *,
    user_id: str,
    fallback_role: str,
    data_scope_override: str | None = None,
) -> tuple[str, list[str], str]:
    """Return (primary_role, permissions, data_scope).

    每人仅一个身份：若历史残留多角色绑定，只取权限最高者参与鉴权。
    """
    role_rows = (
        await db.execute(
            text(
                """
                SELECT r.code AS role_code, r.data_scope
                FROM user_role_assignments ura
                JOIN rbac_roles r ON r.id = ura.role_id
                WHERE ura.user_id = :user_id
                ORDER BY ura.is_primary DESC, r.sort_order
                """
            ),
            {"user_id": user_id},
        )
    ).mappings().all()

    if not role_rows:
        primary = _normalize_role_code(normalize_role(fallback_role))
        db_auth = await _load_role_from_db(db, primary)
        if db_auth:
            permissions = set(db_auth[0])
            data_scope = data_scope_override or db_auth[1]
        else:
            permissions = set(ROLE_PERMISSIONS.get(primary, ()))
            data_scope = data_scope_override or ROLE_DATA_SCOPE.get(primary, "own")
        await _apply_permission_overrides(db, user_id, permissions)
        # 消息通知是所有内部员工的基础入口，不受角色模板或个人 deny 覆盖影响。
        permissions.add("section:notifications")
        return primary, sorted(permissions), data_scope

    rank_inputs: list[tuple[str, str | None, int]] = []
    for row in role_rows:
        role_code = _normalize_role_code(row["role_code"])
        db_auth = await _load_role_from_db(db, role_code)
        perm_count = len(db_auth[0]) if db_auth else 0
        data_scope = (db_auth[1] if db_auth else None) or row["data_scope"] or "own"
        rank_inputs.append((role_code, data_scope, perm_count))

    primary_role = pick_highest_privilege_role(rank_inputs)
    db_auth = await _load_role_from_db(db, primary_role)
    if db_auth:
        permission_set = set(db_auth[0])
        role_data_scope = db_auth[1]
    else:
        permission_set = set(ROLE_PERMISSIONS.get(primary_role, ()))
        role_data_scope = ROLE_DATA_SCOPE.get(primary_role, "own")

    await _apply_permission_overrides(db, user_id, permission_set)
    # 消息通知是所有内部员工的基础入口，不受角色模板或个人 deny 覆盖影响。
    permission_set.add("section:notifications")
    data_scope = data_scope_override or role_data_scope
    return primary_role, sorted(permission_set), data_scope
