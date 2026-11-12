"""directory 缓存 H7 + internal invalidate 路径 B。"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import cache_invalidation
from app.core.redis_client import close_redis, get_redis, reset_redis_for_tests
from app.main import create_app
from app.modules.users import directory_cache


@pytest.fixture
async def redis_ready():
    reset_redis_for_tests()
    client = get_redis()
    if not client.enabled or not await client.is_available():
        pytest.skip("Redis 不可用")
    yield client
    await close_redis()
    reset_redis_for_tests()


@pytest.mark.asyncio
async def test_directory_active_respects_rbac_ver(redis_ready):
    members = [{"id": "u1", "name": "A", "role": "sales", "department_names": []}]
    ver = await cache_invalidation.get_rbac_ver()
    assert await directory_cache.set_directory_active_cached(members, ver0=ver) is True
    hit = await directory_cache.get_directory_active_cached()
    assert hit is not None
    assert hit[0]["id"] == "u1"

    await cache_invalidation.bump_rbac_ver()
    assert await directory_cache.get_directory_active_cached() is None


@pytest.mark.asyncio
async def test_directory_optimistic_set_skips_when_ver_changes(redis_ready):
    """H7：loader 期间 bump → 不得把旧目录写回 Redis。"""
    stale = [{"id": "old", "name": "Stale", "role": "sales", "department_names": []}]

    async def loader_that_bumps():
        await cache_invalidation.bump_rbac_ver()
        return stale

    await redis_ready.cache_del("directory", "active")
    result = await directory_cache.get_or_load_directory_active(loader_that_bumps)
    assert result == stale  # 仍返回本次查询结果
    assert await directory_cache.get_directory_active_cached() is None


@pytest.mark.asyncio
async def test_directory_optimistic_set_writes_when_ver_stable(redis_ready):
    fresh = [{"id": "u2", "name": "Ok", "role": "sales", "department_names": []}]

    async def loader():
        return fresh

    await redis_ready.cache_del("directory", "active")
    result = await directory_cache.get_or_load_directory_active(loader)
    assert result == fresh
    hit = await directory_cache.get_directory_active_cached()
    assert hit is not None and hit[0]["id"] == "u2"

    # 二次命中不回源
    calls = {"n": 0}

    async def should_not_run():
        calls["n"] += 1
        return []

    again = await directory_cache.get_or_load_directory_active(should_not_run)
    assert again[0]["id"] == "u2"
    assert calls["n"] == 0


@pytest.mark.asyncio
async def test_internal_invalidate_requires_token(redis_ready, monkeypatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "redis_internal_token", "test-internal-token")

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        denied = await client.post(
            "/api/internal/cache/invalidate",
            json={"type": "mention_scopes"},
        )
        assert denied.status_code in (403, 404)

        ok = await client.post(
            "/api/internal/cache/invalidate",
            headers={"X-Internal-Token": "test-internal-token"},
            json={"type": "mention_scopes"},
        )
        assert ok.status_code == 200
        assert ok.json().get("ok") is True


@pytest.mark.asyncio
async def test_prefix_handshake_detects_mismatch(redis_ready):
    from app.core.cache_invalidation import (
        PREFIX_HANDSHAKE_KEY,
        announce_runtime_key_prefix,
        check_runtime_key_prefix,
    )

    previous = await redis_ready.absolute_get_json(PREFIX_HANDSHAKE_KEY)
    try:
        await redis_ready.absolute_set_json(
            PREFIX_HANDSHAKE_KEY,
            {"prefix": "other-env", "service": "intruder", "ts": 1},
            ttl=60,
        )
        check = await check_runtime_key_prefix(service="geo-api-test")
        assert check["ok"] is False
        assert check["registeredPrefix"] == "other-env"
        # 冲突时不覆盖
        await announce_runtime_key_prefix(service="geo-api-test")
        raw = await redis_ready.absolute_get_json(PREFIX_HANDSHAKE_KEY)
        assert raw["prefix"] == "other-env"
    finally:
        if isinstance(previous, dict):
            await redis_ready.absolute_set_json(PREFIX_HANDSHAKE_KEY, previous, ttl=7 * 24 * 3600)
        else:
            await redis_ready.absolute_set_json(
                PREFIX_HANDSHAKE_KEY,
                {"prefix": redis_ready.prefix, "service": "pytest-cleanup", "ts": 1},
                ttl=60,
            )


@pytest.mark.asyncio
async def test_health_exposes_redis_prefix_fields(redis_ready):
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/health")
        assert res.status_code == 200
        body = res.json()
        assert "redisKeyPrefix" in body
        assert "redisCrmCacheEnabled" in body
        assert "crmDataVer" in body
        assert "rbacVer" in body
        assert body["redis"] in ("up", "down", "disabled", "unknown")
