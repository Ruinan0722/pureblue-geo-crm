"""JWT 签发与校验（多端统一算法 HS256）。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_settings
from app.core.exceptions import UnauthorizedError

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_WS = "ws_ticket"
WS_TICKET_TTL_SECONDS = 60


@dataclass(frozen=True)
class AccessTokenPayload:
    user_id: str
    role: str


def create_access_token(*, user_id: str, role: str) -> tuple[str, int]:
    settings = get_settings()
    expires_in = settings.jwt_access_token_expire_seconds
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "typ": TOKEN_TYPE_ACCESS,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
    }
    token = jwt.encode(
        payload,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return token, expires_in


def decode_access_token(token: str) -> AccessTokenPayload:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("登录已失效，请重新登录") from exc

    if payload.get("typ") != TOKEN_TYPE_ACCESS:
        raise UnauthorizedError("无效的访问令牌")
    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedError("无效的访问令牌")
    return AccessTokenPayload(user_id=str(user_id), role=str(payload.get("role", "viewer")))


def create_ws_ticket(*, user_id: str) -> tuple[str, int]:
    """短时 WebSocket 握手票据（本地跨端口时 cookie 无法带上，用 ticket 鉴权）。"""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "typ": TOKEN_TYPE_WS,
        "iat": now,
        "exp": now + timedelta(seconds=WS_TICKET_TTL_SECONDS),
    }
    token = jwt.encode(
        payload,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return token, WS_TICKET_TTL_SECONDS


def decode_ws_ticket(token: str) -> str:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("通知通道鉴权失败") from exc
    if payload.get("typ") != TOKEN_TYPE_WS:
        raise UnauthorizedError("通知通道鉴权失败")
    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedError("通知通道鉴权失败")
    return str(user_id)
