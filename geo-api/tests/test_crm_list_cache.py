"""CRM list cache isolation + H7 脏回填防护。"""

from __future__ import annotations

import pytest

from app.core import cache_invalidation
from app.core.redis_client import close_redis, get_redis, reset_redis_for_tests
from app.modules.auth.schemas import AuthUser
from app.modules.crm import crm_list_cache


@pytest.fixture
async def redis_ready():
    reset_redis_for_tests()
    client = get_redis()
    if not client.enabled or not await client.is_available():
        pytest.skip("Redis 不可用")
    yield client
    await close_redis()
    reset_redis_for_tests()


def _user(uid: str, *, scope: str = "own", perms: list[str] | None = None) -> AuthUser:
    return AuthUser(
        id=uid,
        feishu_open_id=f"ou_{uid}",
        name=uid,
        role="sales",
        permissions=perms or ["section:home", "section:leads"],
        data_scope=scope,
    )


@pytest.mark.asyncio
async def test_crm_cache_isolated_by_user(redis_ready, monkeypatch):
    monkeypatch.setattr(crm_list_cache, "crm_cache_enabled", lambda: True)

    a = _user("user-a")
    b = _user("user-b")
    await crm_list_cache.set_cached_crm_blob("wb", a, {"req_pending": 1, "owner": "a"})
    await crm_list_cache.set_cached_crm_blob("wb", b, {"req_pending": 9, "owner": "b"})

    ha = await crm_list_cache.get_cached_crm_blob("wb", a)
    hb = await crm_list_cache.get_cached_crm_blob("wb", b)
    assert ha is not None and ha["owner"] == "a"
    assert hb is not None and hb["owner"] == "b"
    assert ha["req_pending"] != hb["req_pending"]


@pytest.mark.asyncio
async def test_crm_cache_isolated_by_data_scope(redis_ready, monkeypatch):
    monkeypatch.setattr(crm_list_cache, "crm_cache_enabled", lambda: True)
    own = _user("user-scope", scope="own")
    dept = _user("user-scope", scope="department")
    await crm_list_cache.set_cached_crm_blob("boot", own, {"leads": [{"id": "own"}]})
    await crm_list_cache.set_cached_crm_blob("boot", dept, {"leads": [{"id": "dept"}]})
    assert (await crm_list_cache.get_cached_crm_blob("boot", own))["leads"][0]["id"] == "own"
    assert (await crm_list_cache.get_cached_crm_blob("boot", dept))["leads"][0]["id"] == "dept"


@pytest.mark.asyncio
async def test_crm_invalidate_clears_user_prefix(redis_ready, monkeypatch):
    monkeypatch.setattr(crm_list_cache, "crm_cache_enabled", lambda: True)
    u = _user("user-inv")
    await crm_list_cache.set_cached_crm_blob("wb", u, {"x": 1})
    await crm_list_cache.set_cached_crm_blob("boot", u, {"y": 2})
    assert await crm_list_cache.get_cached_crm_blob("wb", u) is not None
    n = await crm_list_cache.invalidate_crm_caches_for_users([u.id])
    assert n >= 1
    assert await crm_list_cache.get_cached_crm_blob("wb", u) is None
    assert await crm_list_cache.get_cached_crm_blob("boot", u) is None


@pytest.mark.asyncio
async def test_crm_optimistic_set_skips_when_ver_changes(redis_ready, monkeypatch):
    """H7：loader 期间 bump → 不得把旧聚合写到新 ver key。"""
    monkeypatch.setattr(crm_list_cache, "crm_cache_enabled", lambda: True)
    u = _user("user-h7")

    async def loader_bumps():
        await cache_invalidation.bump_rbac_ver()
        return {"stale": True, "req_pending": 99}

    out = await crm_list_cache.cached_crm_read("wb", u, loader_bumps)
    assert out["stale"] is True
    # 不应命中缓存（未回填）；再读应 miss 并重新 loader
    assert await crm_list_cache.get_cached_crm_blob("wb", u) is None


@pytest.mark.asyncio
async def test_crm_optimistic_set_writes_when_ver_stable(redis_ready, monkeypatch):
    monkeypatch.setattr(crm_list_cache, "crm_cache_enabled", lambda: True)
    u = _user("user-h7-ok")
    calls = {"n": 0}

    async def loader():
        calls["n"] += 1
        return {"req_pending": 3}

    r1 = await crm_list_cache.cached_crm_read("wb", u, loader)
    assert r1["req_pending"] == 3
    assert calls["n"] == 1

    r2 = await crm_list_cache.cached_crm_read("wb", u, loader)
    assert r2["req_pending"] == 3
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_crm_cache_miss_after_rbac_bump(redis_ready, monkeypatch):
    monkeypatch.setattr(crm_list_cache, "crm_cache_enabled", lambda: True)
    u = _user("user-bump-miss")
    await crm_list_cache.set_cached_crm_blob("wb", u, {"v": 1})
    assert await crm_list_cache.get_cached_crm_blob("wb", u) is not None
    await cache_invalidation.bump_rbac_ver()
    assert await crm_list_cache.get_cached_crm_blob("wb", u) is None


@pytest.mark.asyncio
async def test_crm_data_ver_bump_causes_global_miss(redis_ready, monkeypatch):
    """department/all：任意写 bump crmDataVer 后全员 miss。"""
    monkeypatch.setattr(crm_list_cache, "crm_cache_enabled", lambda: True)
    dept = _user("viewer-dept", scope="department")
    await crm_list_cache.set_cached_crm_blob("wb", dept, {"req_pending": 1})
    assert await crm_list_cache.get_cached_crm_blob("wb", dept) is not None
    await cache_invalidation.bump_crm_data_ver()
    assert await crm_list_cache.get_cached_crm_blob("wb", dept) is None


@pytest.mark.asyncio
async def test_crm_optimistic_set_skips_when_crm_ver_changes(redis_ready, monkeypatch):
    monkeypatch.setattr(crm_list_cache, "crm_cache_enabled", lambda: True)
    u = _user("user-crm-h7")

    async def loader_bumps_crm():
        await cache_invalidation.bump_crm_data_ver()
        return {"stale": True}

    out = await crm_list_cache.cached_crm_read("boot", u, loader_bumps_crm)
    assert out["stale"] is True
    assert await crm_list_cache.get_cached_crm_blob("boot", u) is None
