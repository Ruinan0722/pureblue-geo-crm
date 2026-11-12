"""统一 Redis 客户端：带环境前缀、失败静默降级（读回源 MySQL）。"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

_client: RedisClient | None = None
_AVAIL_TTL_SEC = 2.0


class RedisClient:
    def __init__(self) -> None:
        settings = get_settings()
        self._enabled = bool(settings.redis_cache_enabled and (settings.redis_url or "").strip())
        self._prefix = (settings.redis_key_prefix or "local").strip() or "local"
        self._connect_timeout = max(settings.redis_connect_timeout_ms, 50) / 1000.0
        self._op_timeout = max(settings.redis_op_timeout_ms, 50) / 1000.0
        self._redis: Any = None
        self._available: bool | None = None
        self._available_checked_at = 0.0

        if not self._enabled:
            reason = (
                "REDIS_CACHE_ENABLED=false"
                if not settings.redis_cache_enabled
                else "REDIS_URL empty"
            )
            logger.info("redis cache disabled (%s) prefix=%s", reason, self._prefix)
            return

        try:
            from redis.asyncio import Redis

            self._redis = Redis.from_url(
                settings.redis_url.strip(),
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=self._connect_timeout,
                socket_timeout=self._op_timeout,
            )
            logger.info(
                "redis client initialized prefix=%s url_configured=yes",
                self._prefix,
            )
        except Exception:
            logger.exception("redis client init failed; degrading to MySQL-only")
            self._redis = None
            self._enabled = False

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def prefix(self) -> str:
        return self._prefix

    def key(self, *parts: str) -> str:
        cleaned = [p for p in parts if p]
        return ":".join([self._prefix, *cleaned])

    async def close(self) -> None:
        if self._redis is None:
            return
        try:
            await self._redis.aclose()
        except Exception:
            logger.exception("redis close failed")
        finally:
            self._redis = None

    async def is_available(self) -> bool:
        if not self._enabled or self._redis is None:
            return False
        now = time.monotonic()
        if self._available is not None and now - self._available_checked_at < _AVAIL_TTL_SEC:
            return self._available
        try:
            pong = await self._redis.ping()
            self._available = bool(pong)
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            self._available = False
        self._available_checked_at = now
        return self._available

    def health_status(self) -> str:
        if not self._enabled:
            return "disabled"
        if self._available is True:
            return "up"
        if self._available is False:
            return "down"
        return "unknown"

    async def absolute_get_json(self, key: str) -> Any | None:
        """不带 REDIS_KEY_PREFIX 的 GET（仅用于跨服务前缀握手）。"""
        if not await self.is_available():
            return None
        try:
            raw = await self._redis.get(key)
            if raw is None:
                return None
            try:
                return json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                return raw
        except Exception:
            logger.warning("redis absolute GET failed key=%s", key, exc_info=True)
            self._available = False
            return None

    async def absolute_set_json(self, key: str, value: Any, *, ttl: int) -> bool:
        """不带 REDIS_KEY_PREFIX 的 SET（仅用于跨服务前缀握手）。"""
        if not await self.is_available():
            return False
        try:
            payload = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
            await self._redis.set(key, payload, ex=max(int(ttl), 1))
            return True
        except Exception:
            logger.warning("redis absolute SET failed key=%s", key, exc_info=True)
            self._available = False
            return False

    async def cache_get(self, *parts: str) -> Any | None:
        if not await self.is_available():
            return None
        try:
            raw = await self._redis.get(self.key(*parts))
            if raw is None:
                return None
            try:
                return json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                return raw
        except Exception:
            logger.warning("redis GET failed key=%s", self.key(*parts), exc_info=True)
            self._available = False
            return None

    async def cache_get_raw(self, *parts: str) -> str | None:
        if not await self.is_available():
            return None
        try:
            return await self._redis.get(self.key(*parts))
        except Exception:
            logger.warning("redis GET raw failed key=%s", self.key(*parts), exc_info=True)
            self._available = False
            return None

    async def cache_set(self, *parts: str, value: Any, ttl: int) -> bool:
        if not await self.is_available():
            return False
        try:
            payload = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
            await self._redis.set(self.key(*parts), payload, ex=max(int(ttl), 1))
            return True
        except Exception:
            logger.warning("redis SET failed key=%s", self.key(*parts), exc_info=True)
            self._available = False
            return False

    async def cache_del(self, *parts: str) -> int | None:
        """删除 key。返回删除数量；失败或不可用返回 None（禁用时返回 0）。"""
        if not self._enabled:
            return 0
        if not await self.is_available():
            return None
        try:
            return int(await self._redis.delete(self.key(*parts)))
        except Exception:
            logger.warning("redis DEL failed key=%s", self.key(*parts), exc_info=True)
            self._available = False
            return None

    async def cache_del_many(self, keys: list[tuple[str, ...]]) -> int | None:
        if not keys:
            return 0
        if not self._enabled:
            return 0
        if not await self.is_available():
            return None
        try:
            full = [self.key(*parts) for parts in keys]
            return int(await self._redis.delete(*full))
        except Exception:
            logger.warning("redis DEL many failed count=%s", len(keys), exc_info=True)
            self._available = False
            return None

    async def cache_del_by_prefix(self, *parts: str) -> int | None:
        """SCAN 匹配 `{prefix}:{parts...}:*` 后批量 DEL（勿在热路径滥用）。

        成功返回删除数；失败或不可用返回 None；禁用返回 0。
        """
        if not self._enabled:
            return 0
        if not await self.is_available():
            return None
        pattern = self.key(*parts) + ":*"
        deleted = 0
        try:
            async for key in self._redis.scan_iter(match=pattern, count=100):
                deleted += int(await self._redis.delete(key))
            # 也删精确前缀 key（无后缀）
            exact = self.key(*parts)
            deleted += int(await self._redis.delete(exact))
            return deleted
        except Exception:
            logger.warning("redis SCAN/DEL prefix failed pattern=%s", pattern, exc_info=True)
            self._available = False
            return None

    async def get_int(self, *parts: str) -> int | None:
        raw = await self.cache_get_raw(*parts)
        if raw is None:
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    async def set_nx(self, *parts: str, value: str, ttl: int) -> bool:
        """SET key NX EX ttl；成功抢到锁返回 True。"""
        if not await self.is_available():
            return False
        try:
            ok = await self._redis.set(
                self.key(*parts),
                value,
                nx=True,
                ex=max(int(ttl), 1),
            )
            return bool(ok)
        except Exception:
            logger.warning("redis SET NX failed key=%s", self.key(*parts), exc_info=True)
            self._available = False
            return False

    async def incr(self, *parts: str) -> int | None:
        if not await self.is_available():
            return None
        try:
            return int(await self._redis.incr(self.key(*parts)))
        except Exception:
            logger.warning("redis INCR failed key=%s", self.key(*parts), exc_info=True)
            self._available = False
            return None

    async def publish(self, channel_parts: tuple[str, ...], payload: dict[str, Any] | str) -> bool:
        if not await self.is_available():
            return False
        try:
            message = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
            await self._redis.publish(self.key(*channel_parts), message)
            return True
        except Exception:
            logger.warning("redis PUBLISH failed channel=%s", self.key(*channel_parts), exc_info=True)
            self._available = False
            return False

    def pubsub(self) -> Any | None:
        if not self._enabled or self._redis is None:
            return None
        try:
            return self._redis.pubsub(ignore_subscribe_messages=True)
        except Exception:
            logger.exception("redis pubsub create failed")
            return None


def get_redis() -> RedisClient:
    global _client
    if _client is None:
        _client = RedisClient()
    return _client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


def reset_redis_for_tests() -> None:
    """测试用：清空单例。"""
    global _client
    _client = None
