"""从请求中提取 JWT（Cookie 或 Authorization Bearer）。"""

from __future__ import annotations

from fastapi import Request

from app.config import get_settings


def extract_access_token(request: Request) -> str | None:
    settings = get_settings()
    token = _extract_cookie_value(request, settings.jwt_cookie)
    if token:
        return token
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        bearer = auth_header[7:].strip()
        if bearer:
            return bearer
    return None


def _extract_cookie_value(request: Request, name: str) -> str | None:
    for part in request.headers.get("cookie", "").split(";"):
        part = part.strip()
        if part.startswith(f"{name}="):
            return part.split("=", 1)[1]
    return None
