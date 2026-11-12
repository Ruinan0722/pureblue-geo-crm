"""RBAC 管理服务：管理层级强制、单身份收敛、种子同步、写后缓存失效。"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core import cache_invalidation
from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.models.user import User
from app.modules.auth.rbac_resolver import resolve_user_auth
from app.modules.auth.schemas import AuthUser
from app.modules.rbac.repository import RbacRepository
from app.modules.rbac.schemas import AdminUserOut, PermissionOut, RoleOut
from app.modules.users.role_resolver import resolve_staff_role_for_login

ADMIN_ROLE = "admin"
SUPER_ADMIN_ROLE = "super_admin"

BUILTIN_ROLE_PRIVILEGE: dict[str, int] = {
    "super_admin": 100,
    "admin": 80,
    "marketing_leader": 55,
    "marketing": 45,
    "sales": 40,
    "staff": 40,
    "viewer": 20,
}

DATA_SCOPE_PRIVILEGE: dict[str, int] = {"own": 1, "department": 2, "all": 3}

DATA_SCOPE_LABELS: dict[str, str] = {
    "own": "仅本人",
    "department": "部门及下属",
    "all": "全部数据",
}

_lazy_initialized = False


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _json_str_list(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str):
        import json

        try:
            value = json.loads(raw)
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            return [raw.strip()] if raw.strip() else []
        if isinstance(value, list):
            return [str(x).strip() for x in value if str(x).strip()]
    return []


def role_privilege_rank(code: str, data_scope: str | None, permission_count: int) -> int:
    builtin = BUILTIN_ROLE_PRIVILEGE.get(code)
    if builtin is not None:
        return builtin
    scope = DATA_SCOPE_PRIVILEGE.get(data_scope or "own", 1)
    perms = max(0, min(permission_count or 0, 50))
    return 20 + scope * 10 + perms // 5


def pick_highest_privilege(codes: Sequence[str], rank_of: Any) -> str:
    if not codes:
        raise ValidationError("角色列表为空")
    best = codes[0]
    best_rank = rank_of(best)
    for code in codes[1:]:
        rank = rank_of(code)
        if rank > best_rank:
            best = code
            best_rank = rank
    return best


class AdminHierarchyError(ValueError):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class RbacService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = RbacRepository(db)
        self.settings = get_settings()

    # —— 权限门槛 ——
    @staticmethod
    def _require_settings(user: AuthUser) -> None:
        if "section:settings" not in (user.permissions or []):
            raise PermissionDeniedError("无权限访问系统设置")

    def _designated_super_admin_open_id(self) -> str:
        return self.settings.super_admin_feishu_open_id.strip()

    def _is_super_admin_actor(self, actor: AuthUser) -> bool:
        designated = self._designated_super_admin_open_id()
        if designated:
            return (actor.feishu_open_id or "").strip() == designated
        return actor.role == SUPER_ADMIN_ROLE

    @staticmethod
    def _is_immutable_super_admin(open_id: str | None) -> bool:
        # 由调用方注入 designated open id
        return False

    # —— 层级校验（与前端 admin-hierarchy.ts 对齐）——
    def _assert_privileged_role_allowed(
        self, actor: AuthUser, target_open_id: str | None, role_code: str
    ) -> None:
        if role_code == SUPER_ADMIN_ROLE:
            if (target_open_id or "").strip() != self._designated_super_admin_open_id():
                raise AdminHierarchyError("超级管理员唯一且固定，无法将他人设为超级管理员")
            if not self._is_super_admin_actor(actor):
                raise AdminHierarchyError("仅超级管理员可操作管理员相关权限")
            return
        if role_code == ADMIN_ROLE and not self._is_super_admin_actor(actor):
            raise AdminHierarchyError("仅超级管理员可设置管理员")

    def _assert_can_mutate_target(self, actor: AuthUser, target: dict[str, Any]) -> None:
        open_id = str(target.get("feishuOpenId") or "")
        role = str(target.get("role") or "")
        if open_id == self._designated_super_admin_open_id():
            raise AdminHierarchyError("不可修改超级管理员的权限")
        # 异常超管：仅真实超管可收口
        if (
            role == SUPER_ADMIN_ROLE
            and open_id != self._designated_super_admin_open_id()
            and not self._is_super_admin_actor(actor)
        ):
            raise AdminHierarchyError("不可修改超级管理员的权限")

    def _assert_can_assign_roles(
        self,
        actor: AuthUser,
        target: dict[str, Any] | None,
        role_codes: Sequence[str],
        primary_role_code: str | None = None,
    ) -> None:
        if not role_codes:
            raise AdminHierarchyError("至少分配一个角色")
        if target is not None:
            self._assert_can_mutate_target(actor, target)
        for code in set(role_codes):
            self._assert_privileged_role_allowed(actor, (target or {}).get("feishuOpenId"), code)
        next_code = self._chosen_primary_role(role_codes, primary_role_code)
        self._assert_privileged_role_allowed(actor, (target or {}).get("feishuOpenId"), next_code)

    @staticmethod
    def _chosen_primary_role(role_codes: Sequence[str], primary: str | None) -> str:
        codes = list(role_codes)
        if primary and primary in codes:
            return primary
        if SUPER_ADMIN_ROLE in codes:
            return SUPER_ADMIN_ROLE
        if ADMIN_ROLE in codes:
            return ADMIN_ROLE
        return codes[0]

    def _assert_can_edit_role_template(self, actor: AuthUser, role_code: str) -> None:
        if role_code not in (ADMIN_ROLE, SUPER_ADMIN_ROLE):
            return
        if not self._is_super_admin_actor(actor):
            raise AdminHierarchyError("仅超级管理员可修改管理员 / 超级管理员的角色模板")

    def _assert_can_sync_identity_seed(self, actor: AuthUser) -> None:
        if not self._is_super_admin_actor(actor):
            raise AdminHierarchyError("仅超级管理员可从代码种子恢复系统角色")

    # —— 查询 ——
    async def list_permissions(self, user: AuthUser) -> list[dict[str, Any]]:
        self._require_settings(user)
        await self._ensure_initialized_once()
        rows = await self.repo.list_permissions()
        return [
            PermissionOut(
                code=r.code,
                name=r.name,
                module=r.module,
                sortOrder=r.sort_order,
            ).model_dump()
            for r in rows
        ]

    async def list_roles(self, user: AuthUser) -> list[dict[str, Any]]:
        self._require_settings(user)
        await self._ensure_initialized_once()
        return await self._roles_with_permissions()

    async def _roles_with_permissions(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for role in await self.repo.list_roles():
            perms = await self.repo.role_permissions(role.id)
            out.append(
                RoleOut(
                    id=role.id,
                    code=role.code,
                    name=role.name,
                    description=role.description,
                    dataScope=role.data_scope,
                    isSystem=bool(role.is_system),
                    sortOrder=role.sort_order,
                    permissions=perms,
                ).model_dump()
            )
        return out

    async def get_role(self, user: AuthUser, role_id: str) -> dict[str, Any] | None:
        self._require_settings(user)
        role = await self.repo.get_role(role_id)
        if not role:
            return None
        perms = await self.repo.role_permissions(role.id)
        return RoleOut(
            id=role.id,
            code=role.code,
            name=role.name,
            description=role.description,
            dataScope=role.data_scope,
            isSystem=bool(role.is_system),
            sortOrder=role.sort_order,
            permissions=perms,
        ).model_dump()

    async def get_role_by_code(self, user: AuthUser, code: str) -> dict[str, Any] | None:
        """按角色码查询（仅需登录鉴权）：登录/鉴权链路按 code 解析角色模板。"""
        role = await self.repo.get_role_by_code(code)
        if not role:
            return None
        perms = await self.repo.role_permissions(role.id)
        return RoleOut(
            id=role.id,
            code=role.code,
            name=role.name,
            description=role.description,
            dataScope=role.data_scope,
            isSystem=bool(role.is_system),
            sortOrder=role.sort_order,
            permissions=perms,
        ).model_dump()

    async def meta(self, user: AuthUser) -> dict[str, Any]:
        self._require_settings(user)
        await self._ensure_initialized_once()
        rules = await self.repo.list_department_rules()
        return {
            "dataScopeLabels": DATA_SCOPE_LABELS,
            "autoLoginRules": [
                {"departmentName": r.department_name, "roleCode": r.role_code} for r in rules
            ],
            "superAdminFeishuOpenId": self._designated_super_admin_open_id() or None,
        }

    async def list_users(self, user: AuthUser) -> list[dict[str, Any]]:
        self._require_settings(user)
        rows = (
            await self.db.execute(
                select(User).order_by(User.name)
            )
        ).scalars().all()
        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(await self._admin_user_out(row))
        return out

    async def _admin_user_out(self, row: User) -> dict[str, Any]:
        assignments = await self.repo.user_assignments(row.id)
        role_objs: list[dict[str, Any]] = []
        for assignment in assignments:
            role = await self.repo.get_role(assignment.role_id)
            if role is None:
                continue
            perms = await self.repo.role_permissions(role.id)
            role_objs.append(
                RoleOut(
                    id=role.id,
                    code=role.code,
                    name=role.name,
                    description=role.description,
                    dataScope=role.data_scope,
                    isSystem=bool(role.is_system),
                    sortOrder=role.sort_order,
                    permissions=perms,
                ).model_dump()
            )
        overrides = await self.repo.user_overrides(row.id)
        primary, permissions, data_scope = await resolve_user_auth(
            self.db,
            user_id=row.id,
            fallback_role=row.role,
            data_scope_override=row.data_scope_override,
        )
        return AdminUserOut(
            id=row.id,
            feishuOpenId=row.feishu_open_id,
            name=row.name,
            avatarUrl=row.avatar_url,
            role=primary,
            roleSource=row.role_source or "feishu",
            roleLocked=bool(row.role_locked),
            employmentStatus="resigned" if row.is_resigned else "active",
            leftAt=str(row.left_at) if row.left_at else None,
            dataScopeOverride=row.data_scope_override,
            departmentNames=list(row.department_names or []),
            manualDepartmentOpenId=row.manual_department_open_id,
            manualDepartmentName=row.manual_department_name,
            manualDepartmentNote=row.manual_department_note,
            manualDepartmentLeader=bool(row.manual_department_leader),
            feishuLedDepartmentIds=list(row.feishu_led_department_ids or []),
            roles=role_objs,
            permissionOverrides=[
                {"userId": o.user_id, "permissionCode": o.permission_code, "granted": bool(o.granted)}
                for o in overrides
            ],
            effectivePermissions=permissions,
            effectiveDataScope=data_scope,
        ).model_dump()

    async def get_user(self, user: AuthUser, user_id: str) -> dict[str, Any] | None:
        self._require_settings(user)
        row = (
            await self.db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if row is None:
            return None
        return await self._admin_user_out(row)

    # —— 写操作 ——
    async def set_user_roles(
        self,
        actor: AuthUser,
        user_id: str,
        role_codes: Sequence[str],
        primary_role_code: str | None,
    ) -> None:
        self._require_settings(actor)
        target_row = (
            await self.db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if target_row is None:
            raise NotFoundError("用户不存在")
        target = {
            "feishuOpenId": target_row.feishu_open_id,
            "role": target_row.role,
        }
        self._assert_can_assign_roles(actor, target, role_codes, primary_role_code)
        unique = list(dict.fromkeys(role_codes))
        ranks: dict[str, int] = {}
        for code in unique:
            role = await self.repo.get_role_by_code(code)
            if role is None:
                raise ValidationError(f"角色不存在: {code}")
            perms = await self.repo.role_permissions(role.id)
            ranks[code] = role_privilege_rank(code, role.data_scope, len(perms))
        chosen = (
            pick_highest_privilege(unique, lambda c: ranks.get(c, 0))
            if len(unique) > 1
            else unique[0]
        )
        if primary_role_code and primary_role_code in unique and ranks[primary_role_code] >= ranks[chosen]:
            chosen = primary_role_code
        role = await self.repo.get_role_by_code(chosen)
        if role is None:
            raise ValidationError(f"角色不存在: {chosen}")
        await self.repo.set_user_single_role(user_id, role.id, chosen)
        await self.db.flush()
        await self.db.commit()
        await cache_invalidation.invalidate_after_user_rbac_change(user_id)

    async def set_user_overrides(
        self,
        actor: AuthUser,
        user_id: str,
        overrides: Sequence[tuple[str, bool]],
    ) -> None:
        self._require_settings(actor)
        target_row = (
            await self.db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if target_row is None:
            raise NotFoundError("用户不存在")
        self._assert_can_mutate_target(
            actor, {"feishuOpenId": target_row.feishu_open_id, "role": target_row.role}
        )
        valid = await self.repo.valid_permission_codes()
        for code, _ in overrides:
            if code not in valid:
                raise ValidationError(f"无效权限: {code}")
        await self.repo.replace_user_overrides(user_id, overrides)
        await self.db.flush()
        await self.db.commit()
        await cache_invalidation.invalidate_after_user_rbac_change(user_id)

    async def set_user_role_locked(self, actor: AuthUser, user_id: str, locked: bool) -> None:
        self._require_settings(actor)
        target_row = (
            await self.db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if target_row is None:
            raise NotFoundError("用户不存在")
        self._assert_can_mutate_target(
            actor, {"feishuOpenId": target_row.feishu_open_id, "role": target_row.role}
        )
        await self.repo.set_user_flag(user_id, role_locked=1 if locked else 0)
        await self.db.commit()
        await cache_invalidation.invalidate_after_user_rbac_change(user_id)

    async def set_user_data_scope_override(
        self, actor: AuthUser, user_id: str, data_scope: str | None
    ) -> None:
        self._require_settings(actor)
        target_row = (
            await self.db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if target_row is None:
            raise NotFoundError("用户不存在")
        self._assert_can_mutate_target(
            actor, {"feishuOpenId": target_row.feishu_open_id, "role": target_row.role}
        )
        await self.repo.set_user_flag(user_id, data_scope_override=data_scope)
        await self.db.commit()
        await cache_invalidation.invalidate_after_user_rbac_change(user_id)

    # —— 目录（通讯录）标注 ——
    async def search_directory(self, user: AuthUser, query: str) -> list[dict[str, Any]]:
        self._require_settings(user)
        like = f"%{(query or '').strip()}%"
        rows = (
            await self.db.execute(
                text(
                    """
                    SELECT feishu_open_id, name, department_names,
                           manual_department_name, NULL AS job_title
                    FROM users
                    WHERE name LIKE :like
                    UNION
                    SELECT feishu_open_id, name, department_names,
                           NULL AS manual_department_name, job_title
                    FROM feishu_sales_contacts
                    WHERE is_active = 1 AND name LIKE :like
                    LIMIT 30
                    """
                ),
                {"like": like},
            )
        ).mappings().all()
        by_open_id: dict[str, dict[str, Any]] = {}
        for row in rows:
            open_id = str(row["feishu_open_id"] or "").strip()
            if not open_id:
                continue
            names = _json_str_list(row["department_names"])
            manual = str(row.get("manual_department_name") or "").strip()
            if not names and manual:
                names = [manual]
            job_title = str(row.get("job_title") or "").strip() or None
            existing = by_open_id.get(open_id)
            if existing is None:
                by_open_id[open_id] = {
                    "feishuOpenId": open_id,
                    "name": str(row["name"] or ""),
                    "departmentNames": names,
                    "jobTitle": job_title,
                    "source": "database",
                }
            else:
                if not existing["departmentNames"] and names:
                    existing["departmentNames"] = names
                if not existing["jobTitle"] and job_title:
                    existing["jobTitle"] = job_title
        return list(by_open_id.values())

    async def search_departments(self, user: AuthUser, query: str) -> dict[str, Any]:
        """按名称搜索部门：用户表部门名（去重）+ 飞书通讯录；飞书不可用降级返回。"""
        self._require_settings(user)
        q = (query or "").strip()
        departments: list[dict[str, str]] = []
        if q:
            rows = (await self.db.execute(select(User.department_names))).scalars().all()
            seen: set[str] = set()
            for names in rows:
                for name in names or []:
                    name = str(name or "").strip()
                    if name and q.lower() in name.lower() and name not in seen:
                        seen.add(name)
                        departments.append({"id": name, "name": name, "source": "database"})

        feishu_error: str | None = None
        try:
            from app.core.feishu.client import feishu_post

            data = await feishu_post(
                "/contact/v3/departments/search",
                {
                    "query": q,
                    "department_id_type": "open_department_id",
                    "page_size": 50,
                },
            )
            seen = {d["id"] for d in departments}
            for item in data.get("items") or []:
                dept_id = str(item.get("open_department_id") or "").strip()
                name = str(item.get("name") or "").strip()
                if dept_id and name and dept_id not in seen:
                    seen.add(dept_id)
                    departments.append({"id": dept_id, "name": name, "source": "feishu"})
        except Exception as exc:  # noqa: BLE001 - 飞书不可用时降级返回用户表部门
            feishu_error = str(exc) or "飞书通讯录搜索失败"
        return {"departments": departments, "feishuError": feishu_error}

    async def list_department_members(
        self, user: AuthUser, department_id: str, subtree: bool
    ) -> list[dict[str, str]]:
        """按部门（可选含子树）拉取在职成员 open_id + name。"""
        self._require_settings(user)
        dept_id = (department_id or "").strip()
        if not dept_id:
            return []
        from app.core.feishu.client import get_tenant_access_token
        from app.core.feishu.contact import (
            _collect_department_tree_ids,
            fetch_users_in_departments_concurrent,
        )

        token = await get_tenant_access_token()
        dept_ids = [dept_id]
        if subtree:
            dept_ids += await _collect_department_tree_ids(dept_id, token)
        users = await fetch_users_in_departments_concurrent(dept_ids, token=token, active_only=True)
        members = [
            {
                "feishuOpenId": str(u["open_id"]),
                "name": str(u.get("name") or ""),
            }
            for u in users.values()
            if str(u.get("name") or "").strip()
        ]
        members.sort(key=lambda m: m["name"])
        return members

    async def list_department_children(
        self, user: AuthUser, parent_id: str
    ) -> list[dict[str, str]]:
        """按父部门拉取直接子部门（飞书 children）；飞书失败向上抛错，禁止空列表伪装成功。"""
        self._require_settings(user)
        pid = (parent_id or "").strip()
        if not pid:
            from app.core.exceptions import ValidationError

            raise ValidationError("parentId 必填")
        from app.core.feishu.client import get_tenant_access_token
        from app.core.feishu.contact import list_child_departments

        token = await get_tenant_access_token()
        children = await list_child_departments(pid, token)
        return [
            {"id": item["id"], "name": item["name"], "source": "feishu"}
            for item in children
        ]

    async def directory_leaders_meta(
        self, user: AuthUser, department_id: str | None
    ) -> dict[str, Any]:
        """部门负责人元数据：由用户表 feishu_led_department_ids / manual leader 派生。"""
        self._require_settings(user)
        rows = (await self.db.execute(select(User))).scalars().all()
        leaders_by_dept: dict[str, str] = {}
        profiles: list[dict[str, str]] = []
        for row in rows:
            led_ids = [str(x) for x in (row.feishu_led_department_ids or []) if str(x).strip()]
            if row.manual_department_leader and row.manual_department_open_id:
                led_ids.append(str(row.manual_department_open_id).strip())
            for dept_id in led_ids:
                if department_id and dept_id != department_id:
                    continue
                leaders_by_dept.setdefault(dept_id, row.name)
                profiles.append(
                    {
                        "feishuOpenId": row.feishu_open_id,
                        "departmentOpenId": dept_id,
                        "name": row.name,
                    }
                )
        if department_id:
            return {
                "departmentId": department_id,
                "leaderName": leaders_by_dept.get(department_id),
                "leaderProfiles": profiles,
            }
        return {"leadersByDeptId": leaders_by_dept, "leaderProfiles": profiles}

    async def resolve_directory_departments(
        self, user: AuthUser, open_ids: Sequence[str]
    ) -> dict[str, dict[str, Any]]:
        self._require_settings(user)
        ids = [str(x).strip() for x in open_ids if str(x).strip()]
        if not ids:
            return {}
        rows = (
            await self.db.execute(
                select(User.feishu_open_id, User.department_names, User.manual_department_name).where(
                    User.feishu_open_id.in_(ids)
                )
            )
        ).all()
        return {
            str(open_id): {
                "departmentNames": _json_str_list(department_names),
                "manualDepartmentName": str(manual or "") or None,
            }
            for open_id, department_names, manual in rows
        }

    async def upsert_directory_profile(
        self,
        user: AuthUser,
        *,
        feishu_open_id: str,
        name: str,
        manual_department_open_id: str | None,
        manual_department_name: str | None,
        manual_department_note: str | None,
        manual_department_leader: bool,
    ) -> dict[str, Any]:
        self._require_settings(user)
        feishu_open_id = (feishu_open_id or "").strip()
        name = (name or "").strip()
        if not feishu_open_id or not name:
            raise ValidationError("缺少 feishuOpenId 或 name")
        existing = (
            await self.db.execute(select(User).where(User.feishu_open_id == feishu_open_id))
        ).scalar_one_or_none()
        if existing is not None:
            await self.repo.set_user_flag(
                existing.id,
                manual_department_open_id=manual_department_open_id,
                manual_department_name=manual_department_name,
                manual_department_note=manual_department_note,
                manual_department_leader=1 if manual_department_leader else 0,
            )
            await self.db.commit()
            return {"id": existing.id, "ok": True}
        now = _now()
        new_user = User(
            id=f"u-{uuid4().hex[:16]}",
            feishu_open_id=feishu_open_id,
            name=name,
            role="viewer",
            role_source="feishu",
            role_locked=False,
            department_names=[manual_department_name] if manual_department_name else [],
            manual_department_open_id=manual_department_open_id,
            manual_department_name=manual_department_name,
            manual_department_note=manual_department_note,
            manual_department_leader=manual_department_leader,
            created_at=now,
            updated_at=now,
        )
        self.db.add(new_user)
        await self.db.commit()
        return {"id": new_user.id, "ok": True}

    async def update_user_directory(
        self,
        user: AuthUser,
        user_id: str,
        *,
        manual_department_open_id: str | None,
        manual_department_name: str | None,
        manual_department_note: str | None,
        manual_department_leader: bool,
    ) -> None:
        self._require_settings(user)
        row = (
            await self.db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFoundError("用户不存在")
        await self.repo.set_user_flag(
            user_id,
            manual_department_open_id=manual_department_open_id,
            manual_department_name=manual_department_name,
            manual_department_note=manual_department_note,
            manual_department_leader=1 if manual_department_leader else 0,
        )
        await self.db.commit()
        await cache_invalidation.invalidate_after_user_rbac_change(user_id)

    async def sync_member_profiles(
        self,
        profiles: Sequence[dict[str, Any]],
    ) -> int:
        """内部接口：把 config/feishu-department-map.json 的 memberProfiles 同步到 users.manual_department_*。"""
        updated = 0
        for profile in profiles:
            open_id = str(profile.get("feishuOpenId") or "").strip()
            name = str(profile.get("name") or "").strip()
            if not open_id or not name:
                continue
            row = (
                await self.db.execute(select(User).where(User.feishu_open_id == open_id))
            ).scalar_one_or_none()
            department_name = str(profile.get("departmentName") or "").strip()
            department_open_id = str(profile.get("departmentOpenId") or "").strip()
            note = str(profile.get("note") or "").strip() or None
            leader = bool(profile.get("leader"))
            breadcrumb = str(profile.get("breadcrumb") or "").strip()
            manual_department_name = (
                breadcrumb if ">" in breadcrumb else department_name
            ) or None
            now = _now()
            if row is None:
                row = User(
                    id=f"u-{uuid4().hex[:16]}",
                    feishu_open_id=open_id,
                    name=name,
                    role="viewer",
                    role_source="feishu",
                    role_locked=False,
                    department_names=[department_name] if department_name else [],
                    manual_department_open_id=department_open_id or None,
                    manual_department_name=manual_department_name,
                    manual_department_note=note,
                    manual_department_leader=leader,
                    created_at=now,
                    updated_at=now,
                )
                self.db.add(row)
                await self.db.flush()
                updated += 1
                continue
            await self.repo.set_user_flag(
                row.id,
                name=name,
                manual_department_open_id=department_open_id or None,
                manual_department_name=manual_department_name,
                manual_department_note=note,
                manual_department_leader=1 if leader else 0,
            )
            updated += 1
        if profiles:
            await self.db.commit()
            await cache_invalidation.invalidate_after_org_sync(
                permission_affecting_changes=0
            )
        return updated

    async def toggle_user_role(
        self, actor: AuthUser, user_id: str, role_code: str, enabled: bool
    ) -> None:
        target_row = (
            await self.db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if target_row is None:
            raise NotFoundError("用户不存在")
        target = {"feishuOpenId": target_row.feishu_open_id, "role": target_row.role}
        if enabled:
            self._assert_can_assign_roles(actor, target, [role_code], role_code)
            await self.set_user_roles(actor, user_id, [role_code], role_code)
            await self.repo.set_user_flag(user_id, role_locked=1)
            await self.db.commit()
            await cache_invalidation.invalidate_after_user_rbac_change(user_id)
            return
        await self.revoke_role_binding(actor, user_id, role_code)

    async def revoke_role_binding(
        self, actor: AuthUser, user_id: str, role_code: str
    ) -> None:
        self._require_settings(actor)
        target_row = (
            await self.db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if target_row is None:
            raise NotFoundError("用户不存在")
        target = {"feishuOpenId": target_row.feishu_open_id, "role": target_row.role}
        self._assert_can_mutate_target(actor, target)
        assignments = await self.repo.user_assignments(user_id)
        current = []
        for a in assignments:
            role = await self.repo.get_role(a.role_id)
            if role:
                current.append(role.code)
        if role_code not in current:
            return
        if target_row.role_locked:
            raise ValidationError("该用户角色已锁定，请先解锁后再移除")
        if (target_row.role_source or "feishu") == "manual":
            await self.repo.clear_user_roles(user_id)
            await self.repo.set_user_flag(
                user_id, role_source="feishu", role_locked=0
            )
            await self.db.commit()
            await cache_invalidation.invalidate_after_user_rbac_change(user_id)
            return
        try:
            role, _ = await resolve_staff_role_for_login(
                self.db,
                feishu_open_id=target_row.feishu_open_id,
                department_names=list(target_row.department_names or []),
            )
            db_role = await self.repo.get_role_by_code(role)
            if db_role is None:
                raise NotFoundError(f"角色不存在: {role}")
            await self.repo.set_user_single_role(user_id, db_role.id, role)
            await self.repo.set_user_flag(user_id, role_source="feishu", role_locked=0)
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            await self.repo.clear_user_roles(user_id)
            await self.repo.set_user_flag(user_id, role_source="feishu", role_locked=0)
        await self.db.commit()
        await cache_invalidation.invalidate_after_user_rbac_change(user_id)

    # —— 角色模板 ——
    async def create_role(
        self,
        actor: AuthUser,
        *,
        code: str,
        name: str,
        description: str,
        data_scope: str,
        permissions: Sequence[str],
    ) -> dict[str, Any]:
        self._require_settings(actor)
        code = code.strip()
        if not re.fullmatch(r"[a-z][a-z0-9_]*", code):
            raise ValidationError("角色 code 须为小写字母、数字、下划线，且以字母开头")
        if await self.repo.get_role_by_code(code):
            raise ValidationError("角色 code 已存在")
        valid = await self.repo.valid_permission_codes()
        for p in permissions:
            if p not in valid:
                raise ValidationError(f"无效权限: {p}")
        role = await self.repo.create_role(
            code=code,
            name=name,
            description=description,
            data_scope=data_scope,
            permissions=permissions,
        )
        await self.db.commit()
        await cache_invalidation.invalidate_after_role_matrix_change()
        out = await self.get_role(actor, role.id)
        assert out is not None
        return out

    async def update_role(
        self,
        actor: AuthUser,
        role_id: str,
        *,
        name: str | None,
        description: str | None,
        data_scope: str | None,
        permissions: Sequence[str] | None,
    ) -> dict[str, Any]:
        self._require_settings(actor)
        role = await self.repo.get_role(role_id)
        if role is None:
            raise NotFoundError("角色不存在")
        self._assert_can_edit_role_template(actor, role.code)
        fields: dict[str, Any] = {}
        if name is not None:
            fields["name"] = name
        if description is not None:
            fields["description"] = description
        if data_scope is not None:
            fields["data_scope"] = data_scope
        if permissions is not None:
            valid = await self.repo.valid_permission_codes()
            for p in permissions:
                if p not in valid:
                    raise ValidationError(f"无效权限: {p}")
        await self.repo.update_role_fields(role_id, fields)
        if permissions is not None:
            await self.repo.set_role_permissions(role_id, permissions)
        await self.db.commit()
        await cache_invalidation.invalidate_after_role_matrix_change()
        out = await self.get_role(actor, role_id)
        assert out is not None
        return out

    async def delete_role(self, actor: AuthUser, role_id: str) -> None:
        self._require_settings(actor)
        role = await self.repo.get_role(role_id)
        if role is None:
            raise NotFoundError("角色不存在")
        if role.is_system:
            raise ValidationError("系统内置角色不可删除")
        if await self.repo.count_role_assignments(role_id) > 0:
            raise ValidationError("仍有用户绑定此角色，请先解除分配")
        await self.repo.delete_role(role_id)
        await self.db.commit()
        await cache_invalidation.invalidate_after_role_matrix_change()

    # —— 种子同步 ——
    async def _ensure_initialized_once(self) -> None:
        """幂等冷启动：权限目录 + 缺失系统角色 + 只增不减补权 + 部门规则（进程内一次）。"""
        global _lazy_initialized
        if _lazy_initialized:
            return
        try:
            from scripts.seed_rbac import DEPARTMENT_RULES, PERMISSIONS, ROLES
        except Exception:  # noqa: BLE001  容器未含 scripts 时跳过（DB 由 seed_rbac.py 保证）
            return
        await self.repo.sync_permission_catalog(PERMISSIONS)
        for index, (role_id, code, name, description, data_scope, perms) in enumerate(ROLES, start=1):
            existing = await self.repo.get_role_by_code(code)
            if existing is None:
                await self.repo.create_role(
                    code=code,
                    name=name,
                    description=description,
                    data_scope=data_scope,
                    permissions=perms,
                )
            else:
                # 冷启动：只补齐缺失权限（INSERT IGNORE 语义），不覆盖设置页已配置内容
                current = set(await self.repo.role_permissions(existing.id))
                missing = [p for p in perms if p not in current]
                if missing:
                    await self.repo.set_role_permissions(
                        existing.id, [*current, *missing]
                    )
                if code == "overseas" and existing.data_scope != "all":
                    await self.repo.update_role_fields(existing.id, {"data_scope": "all"})
        await self.repo.ensure_department_rules(
            [(d, r, s) for d, r, s in DEPARTMENT_RULES]
        )
        await self.db.commit()
        _lazy_initialized = True

    async def sync_identity_seed(self, actor: AuthUser) -> list[dict[str, Any]]:
        self._require_settings(actor)
        self._assert_can_sync_identity_seed(actor)
        from scripts.seed_rbac import DEPARTMENT_RULES, PERMISSIONS, ROLES

        await self.repo.sync_permission_catalog(PERMISSIONS)
        for index, (role_id, code, name, description, data_scope, perms) in enumerate(ROLES, start=1):
            existing = await self.repo.get_role_by_code(code)
            if existing is None:
                await self.repo.create_role(
                    code=code,
                    name=name,
                    description=description,
                    data_scope=data_scope,
                    permissions=perms,
                )
            else:
                await self.repo.update_role_fields(
                    existing.id,
                    {
                        "name": name,
                        "description": description,
                        "data_scope": data_scope,
                        "sort_order": index,
                        "is_system": True,
                    },
                )
                await self.repo.set_role_permissions(existing.id, perms)
        await self.repo.replace_department_rules(
            [(d, r, s) for d, r, s in DEPARTMENT_RULES]
        )
        await self.db.commit()
        await cache_invalidation.invalidate_after_role_matrix_change()
        return await self._roles_with_permissions()
