"""@提及候选范围：仅返回对该业务有访问权限且能收通知的成员。"""

from __future__ import annotations

import json
import random

from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache_invalidation import get_rbac_ver
from app.core.redis_client import get_redis
from app.modules.auth.permissions import ROLE_PERMISSIONS, normalize_role
from app.modules.auth.role_privilege import pick_highest_privilege_role

# 各业务 @ 时要求的权限（须同时具备「能收通知」+「能打开对应模块」）
MENTION_SCOPE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "leads": ("section:notifications", "section:leads"),
    "customers": ("section:notifications", "section:customers"),
    "requests": ("section:notifications", "section:requests"),
    "opportunities": ("section:notifications", "section:opportunities"),
}

VALID_MENTION_SCOPES = frozenset(MENTION_SCOPE_PERMISSIONS)

# 各业务实体的负责人（可见性 owner）查询：用于把 @ 候选收窄到“能看这条数据”的人。
# 客户=主档负责人 ∪ 各对接池负责人；线索/商机/需求取负责人列。
MENTION_ENTITY_OWNER_SQL: dict[str, str] = {
    "leads": "SELECT owner_user_id FROM crm_leads WHERE id = :entity_id",
    "customers": (
        "SELECT owner_user_id FROM crm_customers WHERE id = :entity_id "
        "UNION SELECT owner_user_id FROM crm_sales_coverages WHERE customer_id = :entity_id"
    ),
    "opportunities": "SELECT owner_user_id FROM crm_opportunities WHERE id = :entity_id",
    "requests": "SELECT staff_user_id FROM requests WHERE id = :entity_id",
}

_MENTION_TTL_BASE = 90
_MENTION_TTL_JITTER = 30


def normalize_mention_scope(raw: str | None) -> str | None:
    if not raw:
        return None
    scope = raw.strip().lower()
    return scope if scope in VALID_MENTION_SCOPES else None


def required_permissions_for_scope(scope: str) -> tuple[str, ...]:
    return MENTION_SCOPE_PERMISSIONS[scope]


def _norm_role(raw: str | None) -> str:
    role = normalize_role(str(raw or "sales"))
    return "sales" if role == "staff" else role


async def _load_role_permission_map(db: AsyncSession) -> dict[str, set[str]]:
    rows = (
        await db.execute(
            text(
                """
                SELECT r.code AS role_code, rp.permission_code
                FROM rbac_roles r
                LEFT JOIN rbac_role_permissions rp ON rp.role_id = r.id
                """
            )
        )
    ).all()
    result: dict[str, set[str]] = {}
    for role_code, perm in rows:
        code = _norm_role(str(role_code))
        bucket = result.setdefault(code, set())
        if perm:
            bucket.add(str(perm))
    for code, perms in ROLE_PERMISSIONS.items():
        result.setdefault(code, set(perms))
    return result


async def _load_user_primary_roles(
    db: AsyncSession,
    role_perms: dict[str, set[str]],
) -> dict[str, str]:
    """user_id → 主角色 code（多角色时取权限最高者）。"""
    rows = (
        await db.execute(
            text(
                """
                SELECT ura.user_id, r.code AS role_code, r.data_scope
                FROM user_role_assignments ura
                JOIN rbac_roles r ON r.id = ura.role_id
                ORDER BY ura.is_primary DESC, r.sort_order
                """
            )
        )
    ).mappings().all()
    by_user: dict[str, list[tuple[str, str | None, int]]] = {}
    for row in rows:
        uid = str(row["user_id"])
        role_code = _norm_role(str(row["role_code"]))
        by_user.setdefault(uid, []).append(
            (role_code, row["data_scope"], len(role_perms.get(role_code, ())))
        )

    return {uid: pick_highest_privilege_role(items) for uid, items in by_user.items()}


async def _load_user_primary_scopes(db: AsyncSession) -> dict[str, str]:
    """user_id → 主角色 data_scope（own/department/all；默认 own）。"""
    role_scope = {
        _norm_role(str(r[0])): str(r[1] or "own")
        for r in (
            await db.execute(text("SELECT code, data_scope FROM rbac_roles"))
        ).all()
    }
    rows = (
        await db.execute(
            text(
                """
                SELECT ura.user_id, r.code AS role_code
                FROM user_role_assignments ura
                JOIN rbac_roles r ON r.id = ura.role_id
                ORDER BY ura.is_primary DESC, r.sort_order
                """
            )
        )
    ).all()
    by_user: dict[str, str] = {}
    for user_id, role_code in rows:
        uid = str(user_id)
        if uid not in by_user:
            by_user[uid] = role_scope.get(_norm_role(str(role_code)), "own")
    return by_user


def _parse_department_names(raw: str | None) -> set[str]:
    if not raw:
        return set()
    try:
        value = json.loads(raw)
    except Exception:  # noqa: BLE001
        return set()
    if not isinstance(value, list):
        return set()
    return {str(x).strip() for x in value if str(x).strip()}


async def mentionable_user_ids_for_entity(
    db: AsyncSession,
    *,
    scope: str,
    entity_id: str,
) -> set[str]:
    """@ 候选边界：模块权限用户 ∩ 能查看该实体的用户（数据范围近似）。

    规则（与列表可见性对齐的近似）：
    - data_scope=all（管理员/全局）→ 可见；
    - 实体负责人本人（owner / 对接池负责人 / staff）→ 可见；
    - data_scope=department → 部门名与负责人部门有交集才可见（近似，未展开飞书部门树）；
    - 实体无负责人 → 仅 all 范围用户可见（与“未分配仅 leader/admin 可见”一致）。
    """
    entity_id = (entity_id or "").strip()
    if not entity_id:
        return set()
    allowed = await get_mentionable_user_ids_cached(db, scope)
    if not allowed:
        return set()
    sql = MENTION_ENTITY_OWNER_SQL.get(scope)
    if not sql:
        return set()

    owner_ids = {
        str(r[0])
        for r in (await db.execute(text(sql), {"entity_id": entity_id})).all()
        if r[0]
    }
    user_stmt = text("SELECT id, department_names FROM users WHERE id IN :ids").bindparams(
        bindparam("ids", expanding=True)
    )
    user_rows = (await db.execute(user_stmt, {"ids": sorted(allowed)})).all()
    owner_depts: set[str] = set()
    if owner_ids:
        owner_rows = (await db.execute(user_stmt, {"ids": sorted(owner_ids)})).all()
        for _, dept_raw in owner_rows:
            owner_depts |= _parse_department_names(dept_raw)

    user_scope = await _load_user_primary_scopes(db)
    result: set[str] = set()
    for uid, dept_raw in user_rows:
        uid = str(uid)
        data_scope = user_scope.get(uid, "own")
        if data_scope == "all" or uid in owner_ids:
            result.add(uid)
        elif data_scope == "department":
            depts = _parse_department_names(dept_raw)
            if owner_depts and (depts & owner_depts):
                result.add(uid)

    # SDR 部门共享线索池：线索归属任意在职 SDR、无负责人（导入），
    # 或 sdr 归属字段命中 SDR 目录（导入线索）时，全部 SDR 成员都能查看，
    # @ 候选应与可见范围一致。
    if scope == "leads":
        sdr_rows = (
            await db.execute(
                text(
                    "SELECT id, name FROM users "
                    "WHERE employment_status = 'active' AND role = 'sdr'"
                )
            )
        ).all()
        sdr_ids = {str(r[0]) for r in sdr_rows if r[0]}
        sdr_names = {str(r[1]).strip() for r in sdr_rows if r[1] and str(r[1]).strip()}
        lead_sdr_rows = (
            await db.execute(
                text("SELECT sdr FROM crm_leads WHERE id = :entity_id"),
                {"entity_id": entity_id},
            )
        ).all()
        lead_sdr_names = {
            str(r[0]).strip() for r in lead_sdr_rows if r[0] and str(r[0]).strip()
        }
        if not owner_ids or (owner_ids & sdr_ids) or (lead_sdr_names & sdr_names):
            result.update(allowed & sdr_ids)
    return result


async def user_ids_mentionable_for_scope(db: AsyncSession, scope: str) -> set[str]:
    """直连 MySQL 计算（无缓存）。"""
    required = set(required_permissions_for_scope(scope))
    role_perms = await _load_role_permission_map(db)
    primary_roles = await _load_user_primary_roles(db, role_perms)

    users = (
        await db.execute(
            text(
                """
                SELECT id, role FROM users
                WHERE employment_status = 'active'
                """
            )
        )
    ).all()

    allowed: set[str] = set()
    for user_id, fallback_role in users:
        uid = str(user_id)
        role = primary_roles.get(uid) or _norm_role(fallback_role)
        perms = role_perms.get(role) or set(ROLE_PERMISSIONS.get(role, ()))
        if required.issubset(perms):
            allowed.add(uid)
    return allowed


async def get_mentionable_user_ids_cached(db: AsyncSession, scope: str) -> set[str]:
    """Cache-Aside：校验 rbacVer；乐观 SET（见 docs/modules/redis-cache.md）。"""
    if scope not in VALID_MENTION_SCOPES:
        return set()

    redis = get_redis()
    global_ver = await get_rbac_ver()
    cached = await redis.cache_get("mention", "scope", scope)
    if isinstance(cached, dict):
        try:
            cached_ver = int(cached.get("rbacVer", 0))
        except (TypeError, ValueError):
            cached_ver = -1
        if cached_ver >= global_ver:
            raw_ids = cached.get("userIds") or []
            if isinstance(raw_ids, list):
                return {str(uid) for uid in raw_ids}

    ver0 = global_ver
    allowed = await user_ids_mentionable_for_scope(db, scope)
    ver1 = await get_rbac_ver()
    if ver1 == ver0:
        ttl = _MENTION_TTL_BASE + random.randint(0, _MENTION_TTL_JITTER)
        await redis.cache_set(
            "mention",
            "scope",
            scope,
            value={"userIds": sorted(allowed), "rbacVer": ver0},
            ttl=ttl,
        )
    return allowed


async def filter_users_for_mention_scope(
    db: AsyncSession,
    *,
    scope: str,
    users: list,
) -> list:
    """过滤 User 列表，仅保留可被该业务 @ 的成员。"""
    allowed_ids = await get_mentionable_user_ids_cached(db, scope)
    return [u for u in users if getattr(u, "id", None) in allowed_ids]
