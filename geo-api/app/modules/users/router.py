from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.deps import require_user, user_has_permission
from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.users.mention_scope import VALID_MENTION_SCOPES, normalize_mention_scope
from app.modules.users.schemas import (
    DirectManagerResponse,
    DirectoryResponse,
    SalesColleaguesResponse,
)
from app.modules.users.service import UsersService

router = APIRouter(prefix="/users", tags=["users"])

# CRM 下拉 / @提及：任意已登录员工可读通讯录快照（数据来自 MySQL）
_DIRECTORY_PERMS = (
    "section:notifications",
    "section:leads",
    "section:customers",
    "section:opportunities",
    "section:contracts",
    "section:requests",
    "leads:write",
    "customers:write",
    "opportunities:write",
    "contracts:write",
    "request:assign_owner",
)


def _can_read_directory(user: AuthUser) -> bool:
    """仅按运行时有效权限判断，确保用户级 deny 不被角色名兜底绕过。"""
    return any(user_has_permission(user, perm) for perm in _DIRECTORY_PERMS)


@router.get("/directory", response_model=DirectoryResponse)
async def user_directory(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    mention_scope: Annotated[str | None, Query(alias="mentionScope")] = None,
    roles: Annotated[str | None, Query(description="逗号分隔角色，如 presales,viewer")] = None,
    department_names: Annotated[
        str | None,
        Query(alias="departmentNames", description="逗号分隔部门名，匹配 users.department_names"),
    ] = None,
    managed_only: Annotated[
        bool,
        Query(alias="managedOnly", description="仅返回当前用户管辖成员，不含本人"),
    ] = False,
    entity_type: Annotated[
        str | None,
        Query(alias="entityType", description="@ 候选按实体可见性收窄：leads/customers/requests/opportunities"),
    ] = None,
    entity_id: Annotated[str | None, Query(alias="entityId")] = None,
) -> DirectoryResponse:
    if not _can_read_directory(user):
        raise PermissionDeniedError("无权限")
    if mention_scope is not None and normalize_mention_scope(mention_scope) is None:
        raise ValidationError(f"mentionScope 无效，可选：{', '.join(sorted(VALID_MENTION_SCOPES))}")
    if entity_type is not None and normalize_mention_scope(entity_type) is None:
        raise ValidationError(f"entityType 无效，可选：{', '.join(sorted(VALID_MENTION_SCOPES))}")
    role_list = [p.strip() for p in (roles or "").split(",") if p.strip()]
    dept_list = [p.strip() for p in (department_names or "").split(",") if p.strip()]
    return await UsersService(db).list_directory(
        mention_scope=mention_scope,
        roles=role_list or None,
        department_names=dept_list or None,
        viewer_user_id=user.id,
        managed_only=managed_only,
        entity_type=entity_type,
        entity_id=entity_id,
    )


@router.get("/sales-colleagues", response_model=SalesColleaguesResponse)
async def sales_colleagues(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> SalesColleaguesResponse:
    # 分配销售 / 负责人：线索 SDR 等也需要，不再仅限 request:assign_owner
    if not _can_read_directory(user):
        raise PermissionDeniedError("无权限")
    return await UsersService(db).list_sales_colleagues()


@router.get("/direct-manager", response_model=DirectManagerResponse)
async def direct_manager(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    name: Annotated[str, Query(min_length=1, description="合同签订人姓名")],
) -> DirectManagerResponse:
    """按签订人姓名查询飞书直属上级，供合同编辑自动带入。"""
    if not _can_read_directory(user):
        raise PermissionDeniedError("无权限")
    try:
        return await UsersService(db).resolve_direct_manager(name)
    except (NotFoundError, ValidationError):
        raise
    except Exception as exc:  # pragma: no cover - 兜底
        raise ValidationError(str(exc) or "查询直属上级失败") from exc
