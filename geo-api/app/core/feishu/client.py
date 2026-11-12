"""飞书 Open API 客户端（tenant_access_token + HTTP）。

Token 优先 Redis 共享（多 worker）；失败时回退进程内缓存。
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

import httpx

from app.config import get_settings
from app.core.cache_metrics import incr as metric_incr
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

FEISHU_BASE = "https://open.feishu.cn/open-apis"

# 进程内 L1（Redis 不可用或同进程热路径）
_token_cache: dict[str, float | str] = {"expires_at": 0.0, "token": ""}
_token_lock = asyncio.Lock()
_http_client: httpx.AsyncClient | None = None

_TOKEN_KEY = ("feishu", "tenant_token")
_TOKEN_LOCK_KEY = ("feishu", "token_lock")
# 相对飞书过期时间提前失效（秒）
_TOKEN_REFRESH_SKEW_SEC = 300

# 简易熔断：连续失败打开，冷却后半开；open_until 写入 Redis 供多 worker 共享
_circuit_failures = 0
_circuit_open_until = 0.0
_CIRCUIT_THRESHOLD = 5
_CIRCUIT_COOLDOWN_SEC = 60.0
_CIRCUIT_OPEN_KEY = ("feishu", "circuit", "open_until")


async def _sync_circuit_from_redis() -> None:
    global _circuit_open_until
    raw = await get_redis().cache_get_raw(*_CIRCUIT_OPEN_KEY)
    if not raw:
        return
    try:
        until = float(raw)
    except (TypeError, ValueError):
        return
    _circuit_open_until = max(_circuit_open_until, until)


def _assert_circuit_closed() -> None:
    if time.time() < _circuit_open_until:
        raise RuntimeError("飞书接口熔断中，请稍后重试")


async def _assert_circuit_closed_async() -> None:
    await _sync_circuit_from_redis()
    _assert_circuit_closed()


def _circuit_on_success() -> None:
    global _circuit_failures
    _circuit_failures = 0


async def _circuit_on_failure() -> None:
    global _circuit_failures, _circuit_open_until
    _circuit_failures += 1
    metric_incr("feishu_api_fail_total")
    if _circuit_failures >= _CIRCUIT_THRESHOLD:
        until = time.time() + _CIRCUIT_COOLDOWN_SEC
        _circuit_open_until = until
        metric_incr("feishu_circuit_open_total")
        await get_redis().cache_set(
            *_CIRCUIT_OPEN_KEY,
            value=str(until),
            ttl=int(_CIRCUIT_COOLDOWN_SEC) + 5,
        )
        logger.warning(
            "feishu circuit open failures=%s cooldown=%ss",
            _circuit_failures,
            int(_CIRCUIT_COOLDOWN_SEC),
        )


def reset_feishu_circuit_for_tests() -> None:
    global _circuit_failures, _circuit_open_until
    _circuit_failures = 0
    _circuit_open_until = 0.0


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


def is_feishu_configured() -> bool:
    settings = get_settings()
    return bool(settings.feishu_app_id and settings.feishu_app_secret)


def _memory_token_valid(now: float) -> str | None:
    cached = _token_cache.get("token")
    expires_at = float(_token_cache.get("expires_at") or 0)
    if cached and expires_at > now + 60:
        return str(cached)
    return None


def _store_memory_token(token: str, expires_at: float) -> None:
    _token_cache["token"] = token
    _token_cache["expires_at"] = expires_at


async def _read_redis_token(now: float) -> str | None:
    redis = get_redis()
    cached = await redis.cache_get(*_TOKEN_KEY)
    if not isinstance(cached, dict):
        return None
    token = cached.get("accessToken")
    try:
        expire_at = float(cached.get("expireAt") or 0)
    except (TypeError, ValueError):
        return None
    if token and expire_at > now + 60:
        _store_memory_token(str(token), expire_at)
        return str(token)
    return None


async def _write_redis_token(token: str, expire_at: float) -> None:
    ttl = max(int(expire_at - time.time()), 60)
    await get_redis().cache_set(
        *_TOKEN_KEY,
        value={"accessToken": token, "expireAt": expire_at},
        ttl=ttl,
    )


async def _fetch_token_from_feishu() -> tuple[str, float]:
    await _assert_circuit_closed_async()
    settings = get_settings()
    if not settings.feishu_app_id or not settings.feishu_app_secret:
        raise RuntimeError("飞书应用未配置")

    try:
        client = _get_http_client()
        res = await client.post(
            f"{FEISHU_BASE}/auth/v3/app_access_token/internal",
            json={"app_id": settings.feishu_app_id, "app_secret": settings.feishu_app_secret},
        )
        data = res.json()
        if data.get("code") != 0:
            raise RuntimeError(data.get("msg") or "获取飞书 app_access_token 失败")
        token = data["app_access_token"]
        expire = int(data.get("expire", 7200))
        # 提前 5 分钟刷新
        expire_at = time.time() + max(expire - _TOKEN_REFRESH_SKEW_SEC, 60)
        _circuit_on_success()
        return str(token), expire_at
    except Exception:
        await _circuit_on_failure()
        raise


async def get_tenant_access_token() -> str:
    now = time.time()
    mem = _memory_token_valid(now)
    if mem:
        return mem

    redis_token = await _read_redis_token(now)
    if redis_token:
        return redis_token

    redis = get_redis()
    # Redis 可用：短锁防惊群
    if await redis.is_available():
        lock_token = uuid.uuid4().hex
        got_lock = await redis.set_nx(*_TOKEN_LOCK_KEY, value=lock_token, ttl=10)
        if got_lock:
            try:
                # double-check
                again = await _read_redis_token(time.time())
                if again:
                    return again
                token, expire_at = await _fetch_token_from_feishu()
                _store_memory_token(token, expire_at)
                await _write_redis_token(token, expire_at)
                return token
            finally:
                # 仅释放自己的锁（简单对比）
                current = await redis.cache_get_raw(*_TOKEN_LOCK_KEY)
                if current == lock_token:
                    await redis.cache_del(*_TOKEN_LOCK_KEY)
        else:
            for _ in range(15):
                await asyncio.sleep(0.2)
                waited = await _read_redis_token(time.time())
                if waited:
                    return waited
                mem2 = _memory_token_valid(time.time())
                if mem2:
                    return mem2

    # Redis down / 抢锁失败兜底：进程内锁打飞书
    async with _token_lock:
        now2 = time.time()
        mem3 = _memory_token_valid(now2)
        if mem3:
            return mem3
        redis_again = await _read_redis_token(now2)
        if redis_again:
            return redis_again
        token, expire_at = await _fetch_token_from_feishu()
        _store_memory_token(token, expire_at)
        await _write_redis_token(token, expire_at)
        return token


def clear_feishu_token_memory() -> None:
    _token_cache["token"] = ""
    _token_cache["expires_at"] = 0.0


async def feishu_get(path: str, *, token: str | None = None) -> Any:
    await _assert_circuit_closed_async()
    access_token = token or await get_tenant_access_token()
    client = _get_http_client()
    try:
        res = await client.get(
            f"{FEISHU_BASE}{path}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        data = res.json()
        if data.get("code") != 0:
            raise RuntimeError(data.get("msg") or "飞书接口调用失败")
        _circuit_on_success()
        return data.get("data")
    except Exception:
        await _circuit_on_failure()
        raise


async def feishu_post(path: str, body: dict[str, Any], *, token: str | None = None) -> Any:
    await _assert_circuit_closed_async()
    access_token = token or await get_tenant_access_token()
    client = _get_http_client()
    try:
        res = await client.post(
            f"{FEISHU_BASE}{path}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        data = res.json()
        if data.get("code") != 0:
            raise RuntimeError(data.get("msg") or "飞书接口调用失败")
        _circuit_on_success()
        return data.get("data")
    except Exception:
        await _circuit_on_failure()
        raise
