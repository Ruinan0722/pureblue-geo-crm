"""RBAC 管理 API：geo-admin 设置页唯一数据源（替代前端直连 MySQL/Redis）。"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.deps import require_user
from app.core.exceptions import PermissionDeniedError
from app.modules.auth.schemas import AuthUser
from app.modules.rbac.schemas import (
    DataScopeUpdateIn,
    DepartmentChildrenIn,
    DirectoryMembersIn,
    DirectoryUpsertIn,
    GrantIn,
    LockUpdateIn,
    OverridesUpdateIn,
    ResolveDepartmentsIn,
    RoleCreateIn,
    RoleOut,
    RolesUpdateIn,
    RoleUpdateIn,
    UserDirectoryUpdateIn,
)
from app.modules.rbac.service import AdminHierarchyError, RbacService

router = APIRouter(prefix="/rbac", tags=["rbac"])


def _hierarchy_guard(fn):
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except AdminHierarchyError as exc:
            raise PermissionDeniedError(exc.message) from exc

    return wrapper


@router.get("/permissions")
async def list_permissions(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    return {"permissions": await RbacService(db).list_permissions(user)}


@router.get("/meta")
async def meta(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    return await RbacService(db).meta(user)


@router.get("/roles")
async def list_roles(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    return {"roles": await RbacService(db).list_roles(user)}


@router.get("/roles/by-code/{code}", response_model=RoleOut)
async def get_role_by_code(
    code: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    svc = RbacService(db)
    role = await svc.get_role_by_code(user, code)
    if role is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("角色不存在")
    return role


@router.get("/roles/{role_id}", response_model=RoleOut)
async def get_role(
    role_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    svc = RbacService(db)
    role = await svc.get_role(user, role_id)
    if role is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("角色不存在")
    return role


@router.post("/roles", response_model=RoleOut)
async def create_role(
    body: RoleCreateIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    return await _hierarchy_guard(RbacService(db).create_role)(
        user,
        code=body.code,
        name=body.name,
        description=body.description,
        data_scope=body.dataScope,
        permissions=body.permissions,
    )


@router.patch("/roles/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: str,
    body: RoleUpdateIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    return await _hierarchy_guard(RbacService(db).update_role)(
        user,
        role_id,
        name=body.name,
        description=body.description,
        data_scope=body.dataScope,
        permissions=body.permissions,
    )


@router.delete("/roles/{role_id}")
async def delete_role(
    role_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    await _hierarchy_guard(RbacService(db).delete_role)(user, role_id)
    return {"ok": True}


@router.get("/users")
async def list_users(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    return {"users": await RbacService(db).list_users(user)}


@router.get("/users/{user_id}")
async def get_user(
    user_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    svc = RbacService(db)
    detail = await svc.get_user(user, user_id)
    if detail is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("用户不存在")
    return detail


@router.put("/users/{user_id}/roles")
async def set_user_roles(
    user_id: str,
    body: RolesUpdateIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    await _hierarchy_guard(RbacService(db).set_user_roles)(
        user, user_id, body.roleCodes, body.primaryRoleCode
    )
    return {"ok": True}


@router.put("/users/{user_id}/overrides")
async def set_user_overrides(
    user_id: str,
    body: OverridesUpdateIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    await _hierarchy_guard(RbacService(db).set_user_overrides)(
        user, user_id, [(o.permissionCode, o.granted) for o in body.overrides]
    )
    return {"ok": True}


@router.patch("/users/{user_id}/lock")
async def set_user_role_locked(
    user_id: str,
    body: LockUpdateIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    await _hierarchy_guard(RbacService(db).set_user_role_locked)(user, user_id, body.locked)
    return {"ok": True}


@router.patch("/users/{user_id}/data-scope")
async def set_user_data_scope(
    user_id: str,
    body: DataScopeUpdateIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    await _hierarchy_guard(RbacService(db).set_user_data_scope_override)(
        user, user_id, body.dataScope
    )
    return {"ok": True}


@router.post("/users/{user_id}/role-toggle")
async def toggle_user_role(
    user_id: str,
    body: dict[str, Any],
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    role_code = str(body.get("roleCode") or "")
    enabled = bool(body.get("enabled"))
    if not role_code:
        from app.core.exceptions import ValidationError

        raise ValidationError("roleCode 必填")
    await _hierarchy_guard(RbacService(db).toggle_user_role)(
        user, user_id, role_code, enabled
    )
    return {"ok": True}


@router.post("/grant")
async def grant_user_access(
    body: GrantIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    svc = RbacService(db)
    from sqlalchemy import select

    from app.models.user import User

    existing = (
        await db.execute(select(User).where(User.feishu_open_id == body.feishuOpenId))
    ).scalar_one_or_none()
    if existing is None:
        from app.modules.rbac.service import AdminHierarchyError as _AHE

        try:
            svc._assert_can_assign_roles(
                user,
                {"feishuOpenId": body.feishuOpenId, "role": "viewer"},
                body.roleCodes,
                body.primaryRoleCode,
            )
        except _AHE as exc:
            raise PermissionDeniedError(exc.message) from exc
        from uuid import uuid4

        from app.core.time_utils import utc_now

        new_user = User(
            id=f"u-{uuid4().hex[:16]}",
            feishu_open_id=body.feishuOpenId,
            name=body.name,
            avatar_url=body.avatarUrl,
            role="viewer",
            role_source="manual",
            role_locked=True,
            department_names=body.departmentNames or None,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.add(new_user)
        await db.flush()
        await svc.set_user_roles(user, new_user.id, body.roleCodes, body.primaryRoleCode)
        return {"ok": True}
    await svc.set_user_roles(user, existing.id, body.roleCodes, body.primaryRoleCode)
    return {"ok": True}


@router.get("/directory/search")
async def directory_search(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    q: str = "",
) -> dict[str, Any]:
    return {"users": await RbacService(db).search_directory(user, q)}


@router.get("/directory/departments")
async def directory_departments(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    q: str = "",
) -> dict[str, Any]:
    """按名称搜索部门（用户部门名 + 飞书通讯录），供设置页组织树入口。"""
    return await RbacService(db).search_departments(user, q)


@router.post("/directory/members")
async def directory_members(
    body: DirectoryMembersIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    """按部门（可选含子树）拉取成员，供设置页批量开通。"""
    return {
        "members": await RbacService(db).list_department_members(
            user, body.departmentId, body.subtree
        )
    }


@router.post("/directory/department-children")
async def directory_department_children(
    body: DepartmentChildrenIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    """按父部门拉取直接子部门（飞书 children），供设置页组织树展开。"""
    return {
        "children": await RbacService(db).list_department_children(user, body.parentId)
    }


@router.get("/directory/meta")
async def directory_meta(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    departmentId: str = "",
) -> dict[str, Any]:
    """部门负责人元数据（由用户表 feishu_led_department_ids / manual leader 派生）。"""
    return await RbacService(db).directory_leaders_meta(user, departmentId.strip() or None)


@router.post("/directory/resolve-departments")
async def directory_resolve_departments(
    body: ResolveDepartmentsIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    return {
        "departments": await RbacService(db).resolve_directory_departments(
            user, body.openIds
        )
    }


@router.post("/directory/upsert-profile")
async def directory_upsert_profile(
    body: DirectoryUpsertIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    return await RbacService(db).upsert_directory_profile(
        user,
        feishu_open_id=body.feishuOpenId,
        name=body.name,
        manual_department_open_id=body.manualDepartmentOpenId,
        manual_department_name=body.manualDepartmentName,
        manual_department_note=body.manualDepartmentNote,
        manual_department_leader=body.manualDepartmentLeader,
    )


@router.patch("/users/{user_id}/directory")
async def update_user_directory(
    user_id: str,
    body: UserDirectoryUpdateIn,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    await RbacService(db).update_user_directory(
        user,
        user_id,
        manual_department_open_id=body.manualDepartmentOpenId,
        manual_department_name=body.manualDepartmentName,
        manual_department_note=body.manualDepartmentNote,
        manual_department_leader=body.manualDepartmentLeader,
    )
    return {"ok": True}


@router.post("/sync-identity")
async def sync_identity(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    roles = await _hierarchy_guard(RbacService(db).sync_identity_seed)(user)
    return {"ok": True, "message": "已按代码种子恢复系统角色权限与部门映射", "roles": roles, "cacheInvalidated": True}
