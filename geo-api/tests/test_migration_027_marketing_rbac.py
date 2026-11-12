from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_module():
    path = Path(__file__).parents[1] / "alembic" / "versions" / "027_marketing_rbac.py"
    spec = importlib.util.spec_from_file_location("migration_027_marketing_rbac", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_seeds_every_permission_it_assigns() -> None:
    migration = _migration_module()

    assigned = set(migration.MARKETING_PERMISSIONS) | set(migration.MARKETING_LEADER_PERMISSIONS)

    assert assigned <= set(migration.REFERENCED_PERMISSION_CATALOG)
    assert "lead_source_options:manage" in migration.REFERENCED_PERMISSION_CATALOG
