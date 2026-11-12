"""GET /api/version — deploy tag probe."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_api_version_defaults_to_dev(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    monkeypatch.delenv("GEO_ENV", raising=False)
    get_settings.cache_clear()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/version")
    assert res.status_code == 200
    assert res.json() == {"version": "dev", "env": "development", "envLabel": "开发环境"}
    assert res.headers.get("cache-control") == "no-store"


@pytest.mark.asyncio
async def test_api_version_from_env_staging(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_VERSION", "v1.2.0")
    monkeypatch.setenv("GEO_ENV", "staging")
    get_settings.cache_clear()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/version")
    assert res.status_code == 200
    assert res.json() == {
        "version": "v1.2.0",
        "env": "staging",
        "envLabel": "测试环境",
    }
    assert res.headers.get("cache-control") == "no-store"


@pytest.mark.asyncio
async def test_api_version_from_env_production(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_VERSION", "v1.2.0")
    monkeypatch.setenv("GEO_ENV", "production")
    get_settings.cache_clear()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/version")
    assert res.status_code == 200
    assert res.json() == {
        "version": "v1.2.0",
        "env": "production",
        "envLabel": "生产环境",
    }
    assert res.headers.get("cache-control") == "no-store"
