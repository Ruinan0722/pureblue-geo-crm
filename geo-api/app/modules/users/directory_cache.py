"""目录 active 成员短缓存（docs/modules/redis-cache.md 可选 directory:active）。

H7：miss 时记录 ver0 → 查 MySQL → SET 前再读 ver1，仅相等才回填。
"""

from __future__ import annotations

import logging
import random
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.cache_invalidation import get_rbac_ver
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

_DIR_TTL_BASE = 120
_DIR_TTL_JITTER = 20
_DIR_SCHEMA_VERSION = 2


async def get_directory_active_cached() -> list[dict[str, Any]] | None:
    redis = get_redis()
    ver = await get_rbac_ver()
    raw = await redis.cache_get("directory", "active")
    if not isinstance(raw, dict):
        return None
    if raw.get("schemaVersion") != _DIR_SCHEMA_VERSION:
        return None
    try:
        cached_ver = int(raw.get("rbacVer", -1))
    except (TypeError, ValueError):
        return None
    if cached_ver < ver:
        return None
    members = raw.get("members")
    if isinstance(members, list):
        return [m for m in members if isinstance(m, dict)]
    return None


async def set_directory_active_cached(
    members: list[dict[str, Any]],
    *,
    ver0: int,
) -> bool:
    """仅当全局 rbacVer 仍为 ver0 时回填；返回是否写入。"""
    redis = get_redis()
    ver1 = await get_rbac_ver()
    if ver1 != ver0:
        return False
    ttl = _DIR_TTL_BASE + random.randint(0, _DIR_TTL_JITTER)
    await redis.cache_set(
        "directory",
        "active",
        value={"members": members, "rbacVer": ver0, "schemaVersion": _DIR_SCHEMA_VERSION},
        ttl=ttl,
    )
    return True


async def get_or_load_directory_active(
    loader: Callable[[], Awaitable[list[dict[str, Any]]]],
) -> list[dict[str, Any]]:
    """Cache-Aside + H7 乐观回填。"""
    hit = await get_directory_active_cached()
    if hit is not None:
        return hit
    ver0 = await get_rbac_ver()
    members = await loader()
    await set_directory_active_cached(members, ver0=ver0)
    return members
