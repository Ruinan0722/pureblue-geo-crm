"""根据飞书 open_id 与部门名称解析内部角色（优先读 MySQL rbac_department_rules）。"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.modules.auth.permissions import StaffRole

DepartmentRule = tuple[str, str]  # (department_name, role_code)


def _parse_env_list(raw: str) -> list[str]:
    return [s.strip() for s in raw.split(",") if s.strip()]


def _env_department_rules() -> list[DepartmentRule]:
    settings = get_settings()
    rules: list[DepartmentRule] = []
    for name in _parse_env_list(settings.feishu_sales_departments) or ["销售部"]:
        rules.append((name, "sales"))
    for name in _parse_env_list(settings.feishu_viewer_departments) or ["客户成功", "销售运营"]:
        rules.append((name, "viewer"))
    return rules


def _is_super_admin_open_id(feishu_open_id: str) -> bool:
    designated = get_settings().super_admin_open_id
    return bool(designated) and feishu_open_id == designated


def is_super_admin_open_id(feishu_open_id: str) -> bool:
    """Public: 是否为配置的唯一超级管理员 open_id。"""
    return _is_super_admin_open_id(feishu_open_id)


def _is_admin_open_id(feishu_open_id: str) -> bool:
    if _is_super_admin_open_id(feishu_open_id):
        return False
    return feishu_open_id in get_settings().admin_open_id_list


def _department_matches(user_departments: list[str], configured: list[str]) -> bool:
    normalized = [d.strip() for d in user_departments if d.strip()]
    return any(
        dept == cfg or dept in cfg or cfg in dept
        for dept in normalized
        for cfg in configured
        if cfg
    )


def _department_leaf_matches(user_departments: list[str], configured: str) -> bool:
    target = configured.strip()
    return any(raw.rsplit(">", 1)[-1].strip() == target for raw in user_departments if raw.strip())


async def load_department_rules(db: AsyncSession) -> list[DepartmentRule]:
    rows = (
        await db.execute(
            text(
                """
                SELECT department_name, role_code
                FROM rbac_department_rules
                ORDER BY sort_order, department_name
                """
            )
        )
    ).all()
    if rows:
        return [(str(name), str(code)) for name, code in rows]
    return _env_department_rules()


async def get_sales_department_names(db: AsyncSession) -> list[str]:
    rules = await load_department_rules(db)
    names = [name for name, code in rules if code == "sales"]
    return names or _parse_env_list(get_settings().feishu_sales_departments) or ["销售部"]


def _resolve_role_from_departments(
    department_names: list[str],
    rules: list[DepartmentRule],
) -> StaffRole | None:
    for department_name, role_code in rules:
        matched = (
            _department_leaf_matches(department_names, department_name)
            if role_code == "marketing"
            else _department_matches(department_names, [department_name])
        )
        if matched:
            return role_code  # type: ignore[return-value]
    return None


async def resolve_staff_role(
    db: AsyncSession,
    *,
    feishu_open_id: str,
    department_names: list[str],
) -> StaffRole:
    if _is_super_admin_open_id(feishu_open_id):
        return "super_admin"
    if _is_admin_open_id(feishu_open_id):
        return "admin"

    rules = await load_department_rules(db)
    from_departments = _resolve_role_from_departments(department_names, rules)
    if from_departments:
        return from_departments

    raise RuntimeError("您的部门暂无系统访问权限，请联系管理员")


async def resolve_staff_role_for_login(
    db: AsyncSession,
    *,
    feishu_open_id: str,
    department_names: list[str],
) -> tuple[StaffRole, list[str]]:
    if _is_super_admin_open_id(feishu_open_id):
        return "super_admin", department_names

    if _is_admin_open_id(feishu_open_id):
        return "admin", department_names

    rules = await load_department_rules(db)
    from_departments = _resolve_role_from_departments(department_names, rules)
    if from_departments:
        return from_departments, department_names

    # 2026-08：移除「销售树内未映射部门 → 静默 sales」的兜底。
    # 未映射部门的成员不再自动获得销售权限，登录直接拒绝（组织同步按 viewer 入库）。
    raise RuntimeError("您的部门暂无系统访问权限，请联系管理员")


def get_sales_department_names_sync() -> list[str]:
    """无 DB 时的同步兜底（env）。"""
    return _parse_env_list(get_settings().feishu_sales_departments) or ["销售部"]
