from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db_session
from app.core.time_utils import china_now
from app.modules.mark_integration.models import MarkIntegrationNonce

_PLATFORMS = {"website", "36kr", "mark"}


def _bearer_token(request: Request) -> str | None:
    authorization = (request.headers.get("Authorization") or "").strip()
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Authorization 必须使用 Bearer API Key")
    return token.strip()


def _platform_from_json_body(request_body: bytes) -> str:
    import json

    try:
        payload = json.loads(request_body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return ""
    if not isinstance(payload, dict):
        return ""
    return str(payload.get("platformCode") or payload.get("platform_code") or "").strip().lower()


async def _authenticate_bearer(request: Request, token: str) -> str:
    settings = get_settings()
    body = await request.body()
    platform = _platform_from_json_body(body)
    # Mark 材料接口的平台语义固定，不要求材料事件重复携带 platformCode。
    if not platform and "/integrations/mark/leads/" in request.url.path:
        platform = "mark"
    if platform not in _PLATFORMS:
        raise HTTPException(status_code=422, detail="缺少或无效的 platformCode")
    expected = settings.lead_integration_token_for(platform)
    if not settings.lead_integration_enabled or not expected:
        raise HTTPException(status_code=503, detail="线索集成接口未启用或平台 API Key 未配置")
    if not hmac.compare_digest(expected, token):
        raise HTTPException(status_code=401, detail="Bearer API Key 无效")
    request.state.integration_platform = platform
    request.state.integration_auth_scheme = "bearer"
    return platform


async def require_integration_auth(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    """推荐 Bearer API Key；兼容期允许旧 HMAC + X-Platform-Code。"""
    token = _bearer_token(request)
    if token is not None:
        await _authenticate_bearer(request, token)
        return
    if not get_settings().lead_integration_legacy_hmac_enabled:
        raise HTTPException(status_code=401, detail="缺少 Authorization: Bearer <API Key>")
    await require_integration_signature(request, db)
    request.state.integration_auth_scheme = "hmac"


async def require_integration_signature(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    settings = get_settings()
    platform = (request.headers.get("X-Platform-Code") or "").strip().lower()
    timestamp_raw = (request.headers.get("X-Timestamp") or "").strip()
    nonce = (request.headers.get("X-Nonce") or "").strip()
    signature = (request.headers.get("X-Signature") or "").strip().lower()
    if platform not in _PLATFORMS or not timestamp_raw or not nonce or not signature:
        raise HTTPException(status_code=401, detail="缺少或无效的集成签名请求头")
    secret = settings.lead_integration_secret_for(platform)
    if not settings.lead_integration_enabled or not secret:
        raise HTTPException(status_code=503, detail="线索集成接口未启用")
    if len(nonce) > 128:
        raise HTTPException(status_code=401, detail="无效的 Nonce")

    try:
        timestamp = int(timestamp_raw)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="无效的请求时间戳") from exc
    tolerance = max(30, int(settings.lead_integration_timestamp_tolerance_seconds))
    if abs(int(time.time()) - timestamp) > tolerance:
        raise HTTPException(status_code=401, detail="请求时间戳已过期")

    body = await request.body()
    body_hash = hashlib.sha256(body).hexdigest()
    signing_text = f"{request.method.upper()}\n{request.url.path}\n{timestamp_raw}\n{nonce}\n{body_hash}"
    expected = hmac.new(secret.encode(), signing_text.encode(), hashlib.sha256).hexdigest()
    supplied = signature.removeprefix("sha256=")
    if not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=401, detail="集成请求签名验证失败")

    existing = await db.execute(
        select(MarkIntegrationNonce.id).where(
            MarkIntegrationNonce.platform == platform,
            MarkIntegrationNonce.nonce == nonce,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=401, detail="请求 Nonce 已使用")
    now = china_now()
    await db.execute(
        delete(MarkIntegrationNonce).where(
            MarkIntegrationNonce.created_at < now - timedelta(seconds=tolerance * 2)
        )
    )
    db.add(
        MarkIntegrationNonce(
            id=str(uuid.uuid4()),
            platform=platform,
            nonce=nonce,
            request_timestamp=datetime.fromtimestamp(timestamp),
            created_at=now,
        )
    )
    try:
        # Nonce 独立提交，保证后续业务失败时同一签名也不能重放。
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=401, detail="请求 Nonce 已使用") from exc

    request.state.integration_platform = platform


# 保留旧名称，避免旧测试或内部引用立即失效。
require_mark_signature = require_integration_signature
