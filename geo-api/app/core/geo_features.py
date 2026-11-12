from __future__ import annotations

"""GEO_ENV + feature flags for geo-api.

Prefer GEO_ENV; fall back to APP_ENV for compatibility.
Security validators stay on APP_ENV=production (config.py).
"""

from functools import lru_cache
from typing import Literal

from app.config import get_settings

GeoEnv = Literal["development", "staging", "production"]
GeoFeature = Literal["API_DOCS", "HEALTH_CACHE_METRICS", "RELEASE_NOTES", "DEV_IDENTITY"]

GEO_ENV_LABELS: dict[GeoEnv, str] = {
    "development": "开发环境",
    "staging": "测试环境",
    "production": "生产环境",
}

_DEFAULTS: dict[GeoEnv, dict[GeoFeature, bool]] = {
    "development": {
        "API_DOCS": True,
        "HEALTH_CACHE_METRICS": True,
        "RELEASE_NOTES": True,
        "DEV_IDENTITY": True,
    },
    "staging": {
        "API_DOCS": True,
        "HEALTH_CACHE_METRICS": True,
        "RELEASE_NOTES": True,
        "DEV_IDENTITY": True,
    },
    "production": {
        "API_DOCS": False,
        "HEALTH_CACHE_METRICS": False,
        "RELEASE_NOTES": True,
        "DEV_IDENTITY": False,
    },
}


def _normalize(raw: str | None) -> GeoEnv | None:
    if not raw:
        return None
    v = raw.strip().lower()
    if v in {"development", "dev", "local"}:
        return "development"
    if v in {"staging", "stage", "test"}:
        return "staging"
    if v in {"production", "prod"}:
        return "production"
    return None


def get_geo_env() -> GeoEnv:
    import os

    settings = get_settings()
    # Prefer explicit GEO_ENV (process env overrides Settings/.env via pydantic).
    from_geo = _normalize(os.environ.get("GEO_ENV")) or _normalize(getattr(settings, "geo_env", None))
    if from_geo:
        return from_geo
    # Fall back to APP_ENV (process first, then Settings).
    from_app = _normalize(os.environ.get("APP_ENV")) or _normalize(settings.app_env)
    if from_app:
        return from_app
    return "development"


def geo_env_label(env: GeoEnv | None = None) -> str:
    """环境中文名（开发/测试/生产），供 /api/version 等版本提示做环境区分。"""
    return GEO_ENV_LABELS[env or get_geo_env()]


def _parse_bool(raw: str | None) -> bool | None:
    if raw is None:
        return None
    v = raw.strip().lower()
    if not v:
        return None
    if v in {"1", "true", "yes", "on"}:
        return True
    if v in {"0", "false", "no", "off"}:
        return False
    return None


@lru_cache
def is_feature_enabled(feature: GeoFeature) -> bool:
    import os

    key = f"GEO_FEATURE_{feature}"
    override = _parse_bool(os.environ.get(key))
    if override is not None:
        return override

    # Legacy: API_DOCS_ENABLED overrides defaults (deploy/ops)
    if feature == "API_DOCS":
        legacy = _parse_bool(os.environ.get("API_DOCS_ENABLED"))
        if legacy is not None:
            return legacy

    return _DEFAULTS[get_geo_env()][feature]


def clear_feature_cache() -> None:
    is_feature_enabled.cache_clear()
