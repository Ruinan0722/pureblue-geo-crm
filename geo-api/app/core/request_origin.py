from __future__ import annotations

from urllib.parse import urlparse

from fastapi import Request

from app.config import get_settings


def resolve_admin_portal_url(request: Request) -> str:
    """解析管理端对外 URL，优先使用代理转发的 Host。"""
    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_host:
        host = forwarded_host.split(",")[0].strip()
        proto = (request.headers.get("x-forwarded-proto") or "http").split(",")[0].strip()
        if host:
            return f"{proto}://{host}".rstrip("/")

    host = request.headers.get("host")
    if host and not host.startswith("127.0.0.1") and not host.startswith("localhost"):
        scheme = request.url.scheme or "http"
        return f"{scheme}://{host}".rstrip("/")

    referer = request.headers.get("referer")
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

    return get_settings().admin_portal_url.rstrip("/")


def resolve_feishu_redirect_uri(request: Request) -> str:
    return f"{resolve_admin_portal_url(request)}/api/auth/feishu/callback"
