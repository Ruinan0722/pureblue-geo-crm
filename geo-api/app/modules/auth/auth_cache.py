"""Auth / RBAC 用户鉴权 Cache-Aside（见 docs/modules/redis-cache.md）。"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache_invalidation import get_rbac_ver
from app.core.redis_client import get_redis
from app.modules.auth.rbac_resolver import resolve_user_auth as resolve_user_auth_db

logger = logging.getLogger(__name__)

_AUTH_TTL_BASE = 120
_AUTH_TTL_JITTER = 30


async def resolve_user_auth(
    db: AsyncSession,
    *,
    user_id: str,
    fallback_role: str,
    data_scope_override: str | None = None,
) -> tuple[str, list[str], str]:
    """带 Redis 缓存的 resolve；签名与 rbac_resolver.resolve_user_auth 一致。"""
    redis = get_redis()
    global_ver = await get_rbac_ver()
    cached = await redis.cache_get("auth", "user", user_id)
    if isinstance(cached, dict):
        try:
            cached_ver = int(cached.get("rbacVer", 0))
        except (TypeError, ValueError):
            cached_ver = -1
        if cached_ver >= global_ver:
            role = str(cached.get("role") or fallback_role)
            perms = cached.get("permissions") or []
            if not isinstance(perms, list):
                perms = []
            scope = str(cached.get("dataScope") or "own")
            return role, [str(p) for p in perms], scope

    ver0 = global_ver
    role, permissions, data_scope = await resolve_user_auth_db(
        db,
        user_id=user_id,
        fallback_role=fallback_role,
        data_scope_override=data_scope_override,
    )

    ver1 = await get_rbac_ver()
    if ver1 == ver0:
        ttl = _AUTH_TTL_BASE + random.randint(0, _AUTH_TTL_JITTER)
        await redis.cache_set(
            "auth",
            "user",
            user_id,
            value={
                "role": role,
                "permissions": permissions,
                "dataScope": data_scope,
                "rbacVer": ver0,
                "cachedAt": datetime.now(timezone.utc).isoformat(),
            },
            ttl=ttl,
        )
    return role, permissions, data_scope
