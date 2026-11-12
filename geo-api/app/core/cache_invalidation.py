"""缓存失效与版本号（auth / mention / feishu 共用）。"""

from __future__ import annotations

import logging
import time

from app.core.cache_metrics import incr as metric_incr
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

REDIS_VER_PARTS = ("meta", "cache_ver", "rbac")
RBAC_VER_PARTS = REDIS_VER_PARTS
# CRM 列表/工作台数据版本：任意 CRM/需求写后 INCR，使 department/all 范围立即 miss
CRM_DATA_VER_PARTS = ("meta", "cache_ver", "crm")
# 与 mention_scope.VALID_MENTION_SCOPES 保持一致（避免循环 import）
MENTION_SCOPES = ("customers", "leads", "opportunities", "requests")
DIRECTORY_ACTIVE_PARTS = ("directory", "active")
# 无环境前缀的握手 key：检测 api/admin 是否同库却用了不同 REDIS_KEY_PREFIX
PREFIX_HANDSHAKE_KEY = "geo:crm:meta:key_prefix"


async def get_rbac_ver() -> int:
    redis = get_redis()
    value = await redis.get_int(*RBAC_VER_PARTS)
    return int(value or 0)


async def bump_rbac_ver() -> int | None:
    redis = get_redis()
    if not redis.enabled:
        return None
    result = await redis.incr(*RBAC_VER_PARTS)
    if result is None:
        logger.error("redis_invalidate_fail bump rbacVer failed")
        metric_incr("redis_invalidate_fail_total")
    return result


async def get_crm_data_ver() -> int:
    value = await get_redis().get_int(*CRM_DATA_VER_PARTS)
    return int(value or 0)


async def bump_crm_data_ver() -> int | None:
    """CRM/需求写后 bump：department/all 缓存 key 自然 miss。"""
    redis = get_redis()
    if not redis.enabled:
        return None
    result = await redis.incr(*CRM_DATA_VER_PARTS)
    if result is None:
        logger.error("redis_invalidate_fail bump crmDataVer failed")
        metric_incr("redis_invalidate_fail_total")
    return result


async def announce_runtime_key_prefix(*, service: str) -> None:
    """启动时登记 REDIS_KEY_PREFIX。若已有不同前缀登记则不覆盖（保留冲突证据）。"""
    redis = get_redis()
    if not redis.enabled:
        return
    existing = await redis.absolute_get_json(PREFIX_HANDSHAKE_KEY)
    if isinstance(existing, dict) and existing.get("prefix") and str(existing["prefix"]) != redis.prefix:
        return
    await redis.absolute_set_json(
        PREFIX_HANDSHAKE_KEY,
        {"prefix": redis.prefix, "service": service, "ts": int(time.time())},
        ttl=7 * 24 * 3600,
    )


async def check_runtime_key_prefix(*, service: str) -> dict[str, object]:
    """读握手登记；若已有登记且与本地 prefix 不一致则记 metric + 错误日志。"""
    redis = get_redis()
    result: dict[str, object] = {
        "service": service,
        "localPrefix": redis.prefix,
        "registeredPrefix": None,
        "registeredBy": None,
        "ok": True,
    }
    if not redis.enabled or not await redis.is_available():
        return result
    raw = await redis.absolute_get_json(PREFIX_HANDSHAKE_KEY)
    if isinstance(raw, dict) and raw.get("prefix"):
        registered = str(raw["prefix"])
        result["registeredPrefix"] = registered
        result["registeredBy"] = raw.get("service")
        if registered != redis.prefix:
            result["ok"] = False
            metric_incr("redis_prefix_mismatch_total")
            logger.error(
                "redis_prefix_mismatch local=%s registered=%s by=%s service=%s",
                redis.prefix,
                registered,
                raw.get("service"),
                service,
            )
    return result


def _record_invalidate_fail(reason: str, **fields: object) -> None:
    metric_incr("redis_invalidate_fail_total")
    extra = " ".join(f"{k}={v}" for k, v in fields.items() if v is not None)
    logger.error("redis_invalidate_fail reason=%s %s", reason, extra)


async def invalidate_auth_user(user_id: str) -> None:
    if not user_id:
        return
    redis = get_redis()
    if not redis.enabled:
        return
    deleted = await redis.cache_del("auth", "user", user_id)
    if deleted is None:
        _record_invalidate_fail("del_auth_user", userId=user_id)


async def invalidate_mention_scopes() -> None:
    redis = get_redis()
    if not redis.enabled:
        return
    keys = [("mention", "scope", scope) for scope in MENTION_SCOPES]
    deleted = await redis.cache_del_many(keys)
    if deleted is None:
        _record_invalidate_fail("del_mention_scopes")


async def invalidate_directory_active() -> None:
    redis = get_redis()
    if not redis.enabled:
        return
    deleted = await redis.cache_del(*DIRECTORY_ACTIVE_PARTS)
    if deleted is None:
        _record_invalidate_fail("del_directory_active")


async def invalidate_feishu_caches() -> int:
    """清飞书共享缓存（sales_colleagues + dept_tree* + token 可选保留）。"""
    redis = get_redis()
    deleted = 0
    n1 = await redis.cache_del("feishu", "sales_colleagues")
    if n1 is None:
        _record_invalidate_fail("del_feishu_sales_colleagues")
    else:
        deleted += n1
    n2 = await redis.cache_del_by_prefix("feishu", "dept_tree")
    if n2 is None:
        _record_invalidate_fail("del_feishu_dept_tree")
    else:
        deleted += n2
    # token 仍可复用；组织同步不强制踢 token
    try:
        from app.core.feishu.contact import clear_feishu_contact_memory_caches

        clear_feishu_contact_memory_caches()
    except Exception:
        logger.exception("clear feishu memory caches failed")
    return deleted


async def invalidate_after_user_rbac_change(user_id: str | None = None) -> None:
    """单用户权限相关写后：INCR + 可选 DEL auth + 清 mention/directory。"""
    await bump_rbac_ver()
    if user_id:
        await invalidate_auth_user(user_id)
    await invalidate_mention_scopes()
    await invalidate_directory_active()
    if user_id:
        try:
            from app.modules.crm.crm_list_cache import invalidate_crm_caches_for_users

            await invalidate_crm_caches_for_users([user_id])
        except Exception:
            _record_invalidate_fail("crm_after_rbac_user", userId=user_id)
            logger.exception("invalidate crm caches after rbac user change failed")


async def invalidate_after_role_matrix_change() -> None:
    """角色权限矩阵变更：INCR + 清 mention/directory。"""
    await bump_rbac_ver()
    await invalidate_mention_scopes()
    await invalidate_directory_active()


async def invalidate_after_org_sync(*, permission_affecting_changes: int) -> None:
    """组织同步成功后批量失效（H5：条件 bump）。

    总会清 feishu / mention / directory；仅 permission_affecting_changes>0 时 INCR rbacVer。
    """
    started = time.monotonic()
    redis = get_redis()
    deleted = 0
    bumped = False

    try:
        n_dir = await redis.cache_del(*DIRECTORY_ACTIVE_PARTS)
        if n_dir is None:
            _record_invalidate_fail("org_sync_del_directory")
        else:
            deleted += n_dir
        mention_keys = [("mention", "scope", scope) for scope in MENTION_SCOPES]
        n_mention = await redis.cache_del_many(mention_keys)
        if n_mention is None:
            _record_invalidate_fail("org_sync_del_mention")
        else:
            deleted += n_mention

        deleted += await invalidate_feishu_caches()

        if permission_affecting_changes > 0:
            ver = await bump_rbac_ver()
            bumped = ver is not None

        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "invalidate_after_org_sync ok deleted≈%s bump=%s permission_changes=%s elapsed_ms=%s",
            deleted,
            bumped,
            permission_affecting_changes,
            elapsed_ms,
        )
    except Exception:
        _record_invalidate_fail("org_sync", permission_changes=permission_affecting_changes)
        logger.exception(
            "redis_invalidate_fail invalidate_after_org_sync permission_changes=%s",
            permission_affecting_changes,
        )
