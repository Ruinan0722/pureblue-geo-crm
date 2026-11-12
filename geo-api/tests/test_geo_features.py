"""GEO_ENV + feature flags."""

from __future__ import annotations

import pytest

from app.core import geo_features


@pytest.fixture(autouse=True)
def _clear_cache(monkeypatch: pytest.MonkeyPatch):
    geo_features.clear_feature_cache()
    yield
    geo_features.clear_feature_cache()


def test_get_geo_env_from_geo_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GEO_ENV", "staging")
    assert geo_features.get_geo_env() == "staging"


def test_get_geo_env_falls_back_to_app_env(monkeypatch: pytest.MonkeyPatch):
    # Empty GEO_ENV overrides any value from geo-api/.env so APP_ENV can apply.
    monkeypatch.setenv("GEO_ENV", "")
    monkeypatch.setenv("APP_ENV", "staging")
    from app.config import get_settings

    get_settings.cache_clear()
    geo_features.clear_feature_cache()
    assert geo_features.get_geo_env() == "staging"
    get_settings.cache_clear()


def test_reload_settings_clears_feature_cache(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GEO_ENV", "production")
    monkeypatch.delenv("GEO_FEATURE_API_DOCS", raising=False)
    monkeypatch.delenv("API_DOCS_ENABLED", raising=False)
    from app.config import get_settings, reload_settings

    get_settings.cache_clear()
    geo_features.clear_feature_cache()
    assert geo_features.is_feature_enabled("API_DOCS") is False

    monkeypatch.setenv("GEO_ENV", "staging")
    reload_settings()
    assert geo_features.is_feature_enabled("API_DOCS") is True
    get_settings.cache_clear()
    geo_features.clear_feature_cache()

def test_feature_defaults_by_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GEO_ENV", "production")
    monkeypatch.delenv("GEO_FEATURE_API_DOCS", raising=False)
    monkeypatch.delenv("API_DOCS_ENABLED", raising=False)
    geo_features.clear_feature_cache()
    assert geo_features.is_feature_enabled("API_DOCS") is False
    assert geo_features.is_feature_enabled("HEALTH_CACHE_METRICS") is False

    monkeypatch.setenv("GEO_ENV", "staging")
    geo_features.clear_feature_cache()
    assert geo_features.is_feature_enabled("API_DOCS") is True
    assert geo_features.is_feature_enabled("HEALTH_CACHE_METRICS") is True


def test_feature_override(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GEO_ENV", "production")
    monkeypatch.setenv("GEO_FEATURE_HEALTH_CACHE_METRICS", "true")
    geo_features.clear_feature_cache()
    assert geo_features.is_feature_enabled("HEALTH_CACHE_METRICS") is True
