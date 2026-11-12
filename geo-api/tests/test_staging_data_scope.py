"""Staging data scope force-own exemptions."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core import deps, geo_features


@pytest.fixture(autouse=True)
def _clear_geo_cache():
    geo_features.clear_feature_cache()
    yield
    geo_features.clear_feature_cache()


def _user(**kwargs):
    base = {"role": "sales", "data_scope": "all", "permissions": []}
    base.update(kwargs)
    return SimpleNamespace(**base)


def test_staging_force_own_for_sales(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GEO_ENV", "staging")
    monkeypatch.setenv("STAGING_FORCE_OWN_SCOPE", "true")
    geo_features.clear_feature_cache()
    assert deps.user_data_scope(_user(role="sales", data_scope="all")) == "own"


def test_staging_keeps_all_for_super_admin(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GEO_ENV", "staging")
    monkeypatch.setenv("STAGING_FORCE_OWN_SCOPE", "true")
    geo_features.clear_feature_cache()
    assert deps.user_data_scope(_user(role="super_admin", data_scope="all")) == "all"
    assert deps.user_data_scope(_user(role="admin", data_scope="all")) == "all"


def test_staging_force_own_can_disable(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GEO_ENV", "staging")
    monkeypatch.setenv("STAGING_FORCE_OWN_SCOPE", "false")
    geo_features.clear_feature_cache()
    assert deps.user_data_scope(_user(role="sales", data_scope="department")) == "department"
