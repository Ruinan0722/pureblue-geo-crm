"""Auth / mention 缓存与 rbacVer 行为单测。"""

from __future__ import annotations

import pytest

from app.core import cache_invalidation
from app.core.redis_client import close_redis, get_redis, reset_redis_for_tests
from app.modules.users.mention_scope import get_mentionable_user_ids_cached


@pytest.fixture
async def redis_ready():
    reset_redis_for_tests()
    client = get_redis()
    if not client.enabled or not await client.is_available():
        pytest.skip("Redis 不可用，跳过缓存单测")
    yield client
    await close_redis()
    reset_redis_for_tests()


@pytest.mark.asyncio
async def test_bump_rbac_ver_increments(redis_ready):
    before = await cache_invalidation.get_rbac_ver()
    after = await cache_invalidation.bump_rbac_ver()
    assert after is not None
    assert after == before + 1
    assert await cache_invalidation.get_rbac_ver() == after


@pytest.mark.asyncio
async def test_auth_cache_miss_after_bump(redis_ready, monkeypatch):
    from app.modules.auth import auth_cache

    calls = {"n": 0}

    async def fake_db_resolve(db, *, user_id, fallback_role, data_scope_override=None):
        calls["n"] += 1
        return "sales", ["section:home"], "own"

    monkeypatch.setattr(auth_cache, "resolve_user_auth_db", fake_db_resolve)

    class _DummyDb:
        pass

    db = _DummyDb()
    user_id = "test-auth-cache-user"

    await redis_ready.cache_del("auth", "user", user_id)
    r1 = await auth_cache.resolve_user_auth(db, user_id=user_id, fallback_role="sales")
    assert r1[0] == "sales"
    assert calls["n"] == 1

    # hit
    r2 = await auth_cache.resolve_user_auth(db, user_id=user_id, fallback_role="sales")
    assert r2[0] == "sales"
    assert calls["n"] == 1

    await cache_invalidation.bump_rbac_ver()
    r3 = await auth_cache.resolve_user_auth(db, user_id=user_id, fallback_role="sales")
    assert r3[0] == "sales"
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_mention_cache_miss_after_bump(redis_ready, monkeypatch):
    from app.modules.users import mention_scope

    calls = {"n": 0}

    async def fake_mysql(db, scope):
        calls["n"] += 1
        return {"u1", "u2"} if scope == "leads" else set()

    monkeypatch.setattr(mention_scope, "user_ids_mentionable_for_scope", fake_mysql)

    class _DummyDb:
        pass

    db = _DummyDb()
    await redis_ready.cache_del("mention", "scope", "leads")

    s1 = await get_mentionable_user_ids_cached(db, "leads")
    assert s1 == {"u1", "u2"}
    assert calls["n"] == 1

    s2 = await get_mentionable_user_ids_cached(db, "leads")
    assert s2 == {"u1", "u2"}
    assert calls["n"] == 1

    await cache_invalidation.bump_rbac_ver()
    s3 = await get_mentionable_user_ids_cached(db, "leads")
    assert s3 == {"u1", "u2"}
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_optimistic_set_skips_when_ver_changes(redis_ready, monkeypatch):
    from app.modules.auth import auth_cache

    async def slow_resolve(db, *, user_id, fallback_role, data_scope_override=None):
        # 模拟查库期间发生 bump
        await cache_invalidation.bump_rbac_ver()
        return "viewer", ["section:home"], "own"

    monkeypatch.setattr(auth_cache, "resolve_user_auth_db", slow_resolve)

    class _DummyDb:
        pass

    user_id = "test-auth-optimistic"
    await redis_ready.cache_del("auth", "user", user_id)
    await auth_cache.resolve_user_auth(_DummyDb(), user_id=user_id, fallback_role="sales")
    cached = await redis_ready.cache_get("auth", "user", user_id)
    # ver 已变，不应回填
    assert cached is None
