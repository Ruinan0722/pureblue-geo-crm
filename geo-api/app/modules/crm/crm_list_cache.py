"""CRM workbench / bootstrap 短 TTL 缓存（docs/modules/redis-cache.md）。

硬规则：
- key 必须含 userId + dataScope + permHash + rbacVer + crmDataVer
- MySQL 仍是权威；写成功后主动失效（用户前缀 DEL + bump crmDataVer）
- H7：miss 记 ver0 → loader → SET 前 ver1==ver0 才回填
- REDIS_CRM_CACHE_ENABLED=false 可一键关闭
"""

from __future__ import annotations

import hashlib
import logging
import random
from collections.abc import Awaitable, Callable
from typing import Any

from app.config import get_settings
from app.core.cache_invalidation import bump_crm_data_ver, get_crm_data_ver, get_rbac_ver
from app.core.cache_metrics import incr as metric_incr
from app.core.redis_client import get_redis
from app.modules.auth.schemas import AuthUser

logger = logging.getLogger(__name__)

_CRM_TTL_BASE = 30
_CRM_TTL_JITTER = 10


def crm_cache_enabled() -> bool:
    settings = get_settings()
    return bool(settings.redis_cache_enabled and settings.redis_crm_cache_enabled)


def _perm_hash(user: AuthUser) -> str:
    raw = ",".join(sorted(user.permissions or []))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _cache_parts(kind: str, user: AuthUser, rbac_ver: int, crm_ver: int) -> tuple[str, ...]:
    return (
        "crm",
        kind,
        user.id,
        user.data_scope or "own",
        _perm_hash(user),
        str(rbac_ver),
        str(crm_ver),
    )


async def get_cached_crm_blob(kind: str, user: AuthUser) -> dict[str, Any] | None:
    if not crm_cache_enabled() or not user.id:
        return None
    rbac_ver = await get_rbac_ver()
    crm_ver = await get_crm_data_ver()
    raw = await get_redis().cache_get(*_cache_parts(kind, user, rbac_ver, crm_ver))
    if isinstance(raw, dict):
        metric_incr(f"crm_cache_hit_total_{kind}")
        return raw
    metric_incr(f"crm_cache_miss_total_{kind}")
    return None


async def set_cached_crm_blob(
    kind: str,
    user: AuthUser,
    value: dict[str, Any],
    *,
    rbac_ver: int | None = None,
    crm_ver: int | None = None,
) -> bool:
    """回填缓存；若传入版本与当前全局不一致则跳过（H7）。"""
    if not crm_cache_enabled() or not user.id:
        return False
    current_rbac = await get_rbac_ver()
    current_crm = await get_crm_data_ver()
    if rbac_ver is not None and current_rbac != rbac_ver:
        return False
    if crm_ver is not None and current_crm != crm_ver:
        return False
    use_rbac = rbac_ver if rbac_ver is not None else current_rbac
    use_crm = crm_ver if crm_ver is not None else current_crm
    ttl = _CRM_TTL_BASE + random.randint(0, _CRM_TTL_JITTER)
    await get_redis().cache_set(
        *_cache_parts(kind, user, use_rbac, use_crm),
        value=value,
        ttl=ttl,
    )
    return True


async def cached_crm_read(
    kind: str,
    user: AuthUser,
    loader: Callable[[], Awaitable[dict[str, Any]]],
) -> dict[str, Any]:
    hit = await get_cached_crm_blob(kind, user)
    if hit is not None:
        return hit
    ver0_rbac = await get_rbac_ver()
    ver0_crm = await get_crm_data_ver()
    data = await loader()
    await set_cached_crm_blob(kind, user, data, rbac_ver=ver0_rbac, crm_ver=ver0_crm)
    return data


async def invalidate_crm_caches_for_users(user_ids: list[str] | set[str] | tuple[str, ...]) -> int:
    """写后失效：bump crmDataVer（覆盖 department/all）+ SCAN 删已知用户前缀。"""
    if not crm_cache_enabled():
        return 0
    await bump_crm_data_ver()
    # bump_crm_data_ver 失败时已记 redis_invalidate_fail_total
    redis = get_redis()
    deleted = 0
    seen: set[str] = set()
    for uid in user_ids:
        if not uid or uid in seen:
            continue
        seen.add(uid)
        for kind in ("wb", "boot"):
            n = await redis.cache_del_by_prefix("crm", kind, uid)
            if n is None:
                metric_incr("redis_invalidate_fail_total")
                logger.error("redis_invalidate_fail del crm:%s user=%s", kind, uid)
            else:
                deleted += n
    if deleted:
        metric_incr("crm_cache_invalidate_total", deleted)
    metric_incr("crm_data_ver_bump_total")
    return deleted
