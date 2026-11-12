from __future__ import annotations

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_token import extract_access_token
from app.core.cookies import oauth_state_cookie_options, set_access_token_cookie
from app.core.database import get_db_session
from app.core.exceptions import PermissionDeniedError, ValidationError
from app.core.request_origin import resolve_admin_portal_url, resolve_feishu_redirect_uri
from app.modules.auth.schemas import (
    DevLoginIn,
    FeishuTokenRequest,
    FeishuTokenResponse,
    LogoutResponse,
    MeResponse,
)
from app.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=MeResponse)
async def get_me(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> MeResponse:
    access_token = extract_access_token(request)
    return await AuthService(db).get_me(access_token)


@router.post("/me", response_model=MeResponse)
async def dev_login_me(
    request: Request,
    response: Response,
    body: DevLoginIn,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> MeResponse:
    """开发/Staging 测试身份登录（生产与 Feature Flag 关闭时拒绝）。"""
    from app.core.geo_features import get_geo_env, is_feature_enabled

    if get_geo_env() == "production" or not is_feature_enabled("DEV_IDENTITY"):
        raise PermissionDeniedError("测试身份未启用")
    service = AuthService(db)
    access_token, expires_in = await service.dev_login(name=body.name, role=body.role)
    set_access_token_cookie(
        response,
        access_token,
        expires_in,
        secure=request.url.scheme == "https",
    )
    return await service.get_me(access_token)


@router.delete("/me", response_model=LogoutResponse)
async def logout_me(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> LogoutResponse:
    """退出登录：清除 access token cookie（与 /auth/logout 同语义）。"""
    await AuthService(db).logout(response, portal_url=resolve_admin_portal_url(request))
    return LogoutResponse()


@router.get("/feishu")
async def feishu_login(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> RedirectResponse:
    service = AuthService(db)
    redirect_uri = resolve_feishu_redirect_uri(request)
    portal_url = resolve_admin_portal_url(request)
    try:
        authorize_url, state = service.start_feishu_login(redirect_uri=redirect_uri)
    except ValidationError as exc:
        return RedirectResponse(
            url=service.login_error_redirect(quote(exc.message), portal_url=portal_url),
            status_code=302,
        )
    response = RedirectResponse(url=authorize_url, status_code=302)
    opts = oauth_state_cookie_options(secure=portal_url.startswith("https://"))
    response.set_cookie(value=state, **opts)
    return response


@router.get("/feishu/callback")
async def feishu_callback(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    service = AuthService(db)
    portal_url = resolve_admin_portal_url(request)
    redirect_uri = resolve_feishu_redirect_uri(request)
    if error:
        return RedirectResponse(
            url=service.login_error_redirect(quote("用户拒绝授权"), portal_url=portal_url),
            status_code=302,
        )
    saved_state = request.cookies.get("feishu_oauth_state")
    redirect = RedirectResponse(url="", status_code=302)
    try:
        target = await service.complete_feishu_login(
            code=code or "",
            state=state or "",
            saved_state=saved_state,
            response=redirect,
            portal_url=portal_url,
            redirect_uri=redirect_uri,
        )
        redirect.headers["location"] = target
        return redirect
    except ValidationError as exc:
        return RedirectResponse(
            url=service.login_error_redirect(quote(exc.message), portal_url=portal_url),
            status_code=302,
        )
    except RuntimeError as exc:
        return RedirectResponse(
            url=service.login_error_redirect(quote(str(exc)), portal_url=portal_url),
            status_code=302,
        )


@router.post("/feishu/token", response_model=FeishuTokenResponse)
async def feishu_token_exchange(
    body: FeishuTokenRequest,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> FeishuTokenResponse:
    """移动端 / 原生端：飞书 SDK 拿到 code 后，换取 JWT。"""
    try:
        return await AuthService(db).exchange_feishu_code(body.code)
    except RuntimeError as exc:
        raise ValidationError(str(exc)) from exc


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> LogoutResponse:
    await AuthService(db).logout(response, portal_url=resolve_admin_portal_url(request))
    return LogoutResponse()
