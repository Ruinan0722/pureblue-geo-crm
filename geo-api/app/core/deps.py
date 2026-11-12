from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Cookie, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.auth_token import extract_access_token
from app.core.database import get_db_session
from app.core.exceptions import UnauthorizedError
from app.core.jwt import decode_access_token
from app.modules.auth.repository import AuthRepository
from app.modules.auth.schemas import AuthUser


def user_has_permission(user: AuthUser, permission: str) -> bool:
    return permission in user.permissions


def user_data_scope(user: AuthUser) -> str:
    """Effective CRM/request data scope.

    Staging 默认对业务角色强制 own（可用 STAGING_FORCE_OWN_SCOPE=false 关闭）。
    管理员 / 超级管理员保留 RBAC 数据范围（通常为 all），便于验收全量数据。
    """
    import os

    from app.core.geo_features import get_geo_env

    if get_geo_env() == "staging":
        raw = (os.environ.get("STAGING_FORCE_OWN_SCOPE") or "true").strip().lower()
        if raw in ("1", "true", "yes", "on", ""):
            role = (user.role or "").strip()
            if role not in {"admin", "super_admin"}:
                return "own"
    return user.data_scope or "own"


def user_can_see_unassigned(user: AuthUser) -> bool:
    """无负责人数据：仅 department（销售 Leader 等）与 all（管理员）可见。

    普通销售 data_scope=own 不可见未分配池，避免误认为「我的客户/需求」。
    """
    return user_data_scope(user) in {"department", "all"}


@dataclass
class AuthContext:
    kind: str  # "user" | "customer" | "anonymous"
    user: AuthUser | None = None
    invite_token: str | None = None


async def get_auth_context(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    invite_cookie: Annotated[str | None, Cookie(alias="geo_invite_token")] = None,
) -> AuthContext:
    settings = get_settings()
    # 必须走 extract_access_token：Staging 等环境 JWT_COOKIE 可能不是默认 geo_access_token
    access_token = extract_access_token(request)
    invite_token = invite_cookie or _extract_invite_token(request, settings.invite_cookie)

    if access_token:
        try:
            payload = decode_access_token(access_token)
            repo = AuthRepository(db)
            user = await repo.get_auth_user_by_id(payload.user_id)
            if user:
                return AuthContext(kind="user", user=user)
        except UnauthorizedError:
            pass

    if invite_token:
        return AuthContext(kind="customer", invite_token=invite_token)

    return AuthContext(kind="anonymous")


def _extract_invite_token(request: Request, cookie_name: str) -> str | None:
    for part in request.headers.get("cookie", "").split(";"):
        part = part.strip()
        if part.startswith(f"{cookie_name}="):
            return part.split("=", 1)[1]
    return None


async def require_user(ctx: Annotated[AuthContext, Depends(get_auth_context)]) -> AuthUser:
    if ctx.kind != "user" or not ctx.user:
        raise UnauthorizedError()
    return ctx.user


async def require_permission(permission: str):
    async def _checker(user: Annotated[AuthUser, Depends(require_user)]) -> AuthUser:
        if not user_has_permission(user, permission):
            from app.core.exceptions import PermissionDeniedError

            raise PermissionDeniedError()
        return user

    return _checker


async def _department_peer_ids(
    db: AsyncSession,
    user_id: str,
    department_names: list[str],
) -> list[str]:
    """可见集合：与列表一致走 managed（自己 ∪ 直接下级 ∪ 管辖子树成员）。

    需求列表已切 managed（requests/service.py），详情/改写必须同一集合，
    否则列表可见但详情 403（Leader 跨部门下属），或售前仍可按 ID 打开同伴详情（D3）。
    """
    from app.modules.users.repository import UsersRepository

    return await UsersRepository(db).get_managed_scope_user_ids(user_id)


async def user_can_view_request(
    db: AsyncSession,
    record_staff_user_id: str | None,
    user: AuthUser,
    *,
    request_code: str | None = None,
    request_data: dict | None = None,
) -> bool:
    if not user_has_permission(user, "request:view"):
        return False
    from app.core.geo_scope import forced_geo_source, matches_forced_geo, resolve_request_geo_source

    forced = forced_geo_source(user)
    if forced:
        entity_geo = resolve_request_geo_source(code=request_code, data=request_data)
        if not matches_forced_geo(forced, entity_geo):
            return False
    scope = user_data_scope(user)
    if scope == "all":
        return True
    # 未分配需求：仅 Leader（department）与管理员（all）可见，普通销售不可见
    if not record_staff_user_id:
        return user_can_see_unassigned(user)
    if scope == "department":
        peers = await _department_peer_ids(db, user.id, user.department_names)
        return record_staff_user_id in peers
    return record_staff_user_id == user.id


async def user_can_mutate_request(
    db: AsyncSession,
    record_staff_user_id: str | None,
    user: AuthUser,
    permission: str,
    *,
    request_code: str | None = None,
    request_data: dict | None = None,
) -> bool:
    if not user_has_permission(user, permission):
        return False
    from app.core.geo_scope import forced_geo_source, matches_forced_geo, resolve_request_geo_source

    forced = forced_geo_source(user)
    if forced:
        entity_geo = resolve_request_geo_source(code=request_code, data=request_data)
        if not matches_forced_geo(forced, entity_geo):
            return False
    scope = user_data_scope(user)
    if scope == "all":
        return True
    # 未分配：仅 Leader+ 可认领/分配；普通销售不可操作
    if not record_staff_user_id:
        if permission == "request:assign_owner":
            return user_can_see_unassigned(user) and user_has_permission(user, permission)
        return False
    if scope == "department":
        peers = await _department_peer_ids(db, user.id, user.department_names)
        return record_staff_user_id in peers
    return record_staff_user_id == user.id
