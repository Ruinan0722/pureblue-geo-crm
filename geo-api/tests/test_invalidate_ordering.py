"""写路径失效顺序与 DEL 失败可观测性。"""

from __future__ import annotations

import pytest

from app.core import cache_invalidation
from app.core.cache_metrics import reset_for_tests, snapshot
from app.core.redis_client import close_redis, get_redis, reset_redis_for_tests


@pytest.fixture
async def redis_ready():
    reset_redis_for_tests()
    reset_for_tests()
    client = get_redis()
    if not client.enabled or not await client.is_available():
        pytest.skip("Redis 不可用")
    yield client
    await close_redis()
    reset_redis_for_tests()




@pytest.mark.asyncio
async def test_invalidate_auth_user_metrics_when_del_fails(redis_ready, monkeypatch):
    redis = redis_ready

    async def fail_del(*_parts):
        return None

    monkeypatch.setattr(redis, "cache_del", fail_del)
    before = snapshot().get("redis_invalidate_fail_total", 0)
    await cache_invalidation.invalidate_auth_user("u-metric")
    after = snapshot().get("redis_invalidate_fail_total", 0)
    assert after == before + 1


@pytest.mark.asyncio
async def test_cache_del_returns_none_when_unavailable(redis_ready, monkeypatch):
    redis = redis_ready

    async def down():
        return False

    monkeypatch.setattr(redis, "is_available", down)
    assert await redis.cache_del("auth", "user", "x") is None
    assert await redis.cache_del_many([("mention", "scope", "leads")]) is None
    assert await redis.cache_del_by_prefix("crm", "wb", "u1") is None


@pytest.mark.asyncio
async def test_invalidate_mention_metrics_when_del_fails(redis_ready, monkeypatch):
    redis = redis_ready

    async def fail_many(_keys):
        return None

    monkeypatch.setattr(redis, "cache_del_many", fail_many)
    before = snapshot().get("redis_invalidate_fail_total", 0)
    await cache_invalidation.invalidate_mention_scopes()
    assert snapshot().get("redis_invalidate_fail_total", 0) == before + 1
