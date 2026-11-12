"""飞书浏览器 OAuth 登录（与 geo-admin feishu.ts 对齐）。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.config import get_settings

FEISHU_BASE = "https://open.feishu.cn/open-apis"
FEISHU_AUTH_BASE = "https://accounts.feishu.cn/open-apis"


@dataclass(frozen=True)
class FeishuUserInfo:
    open_id: str
    name: str
    tenant_key: str
    avatar_url: str | None = None


def is_feishu_oauth_configured() -> bool:
    settings = get_settings()
    return bool(settings.feishu_app_id and settings.feishu_app_secret and settings.feishu_redirect_uri)


def get_feishu_authorize_url(state: str, redirect_uri: str | None = None) -> str:
    settings = get_settings()
    if not is_feishu_oauth_configured():
        raise RuntimeError("飞书应用未配置")
    uri = quote(redirect_uri or settings.feishu_redirect_uri, safe="")
    params = (
        f"client_id={settings.feishu_app_id}"
        f"&response_type=code"
        f"&redirect_uri={uri}"
        f"&state={state}"
        "&scope=contact:user.base:readonly%20contact:user.department:readonly"
    )
    return f"{FEISHU_AUTH_BASE}/authen/v1/authorize?{params}"


async def _fetch_user_info(user_access_token: str) -> FeishuUserInfo:
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(
            f"{FEISHU_BASE}/authen/v1/user_info",
            headers={
                "Authorization": f"Bearer {user_access_token}",
                "Content-Type": "application/json",
            },
        )
        data = res.json()
        if data.get("code") != 0 or not data.get("data"):
            raise RuntimeError(data.get("msg") or "获取飞书用户信息失败")
        raw: dict[str, Any] = data["data"]
        return FeishuUserInfo(
            open_id=raw["open_id"],
            name=raw["name"],
            tenant_key=raw["tenant_key"],
            avatar_url=raw.get("avatar_url"),
        )


async def exchange_browser_oauth_code(code: str, redirect_uri: str | None = None) -> FeishuUserInfo:
    settings = get_settings()
    if not is_feishu_oauth_configured():
        raise RuntimeError("飞书应用未配置")
    uri = redirect_uri or settings.feishu_redirect_uri

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            f"{FEISHU_BASE}/authen/v2/oauth/token",
            json={
                "grant_type": "authorization_code",
                "client_id": settings.feishu_app_id,
                "client_secret": settings.feishu_app_secret,
                "code": code,
                "redirect_uri": uri,
            },
        )
        data = res.json()
        if data.get("code") != 0 or not data.get("access_token"):
            raise RuntimeError(data.get("msg") or "飞书登录失败")
        return await _fetch_user_info(data["access_token"])


def assert_tenant_allowed(tenant_key: str) -> None:
    settings = get_settings()
    if settings.feishu_tenant_key and tenant_key != settings.feishu_tenant_key:
        raise RuntimeError("仅本公司飞书账号可登录")
