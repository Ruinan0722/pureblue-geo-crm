from __future__ import annotations

import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.modules.auth.schemas import AuthUser
from app.modules.projects.schemas import ProjectRecord
from app.modules.projects.service import ProjectsService


def _user(*, permissions: list[str], role: str = "viewer", data_scope: str = "own") -> AuthUser:
    return AuthUser(
        id="u1",
        feishu_open_id="ou1",
        name="测试用户",
        role=role,
        permissions=permissions,
        data_scope=data_scope,
    )


def _record(project_id: str) -> ProjectRecord:
    return ProjectRecord(
        id=project_id,
        name=f"项目-{project_id}",
        customer_id="c1",
        customer_name="客户",
        source_contract_id=f"ct-{project_id}",
        stage="active",
        health="healthy",
        risk_level="low",
        created_at="2026-08-11",
        updated_at="2026-08-11",
    )


@pytest.mark.asyncio
async def test_project_by_contract_reuses_row_visibility():
    service = ProjectsService(object())  # type: ignore[arg-type]
    row = SimpleNamespace(id="p1")
    service.repo = MagicMock()
    service.repo.get_by_contract_id = AsyncMock(return_value=row)
    service.get_project = AsyncMock(return_value=_record("p1"))

    result = await service.get_project_by_contract(
        _user(permissions=["section:projects"]), "ct1"
    )

    assert result.id == "p1"
    service.get_project.assert_awaited_once()


@pytest.mark.asyncio
async def test_project_by_contract_requires_section_and_handles_missing():
    service = ProjectsService(object())  # type: ignore[arg-type]
    service.repo = MagicMock()
    service.repo.get_by_contract_id = AsyncMock(return_value=None)
    with pytest.raises(PermissionDeniedError):
        await service.get_project_by_contract(_user(permissions=[]), "ct1")
    with pytest.raises(NotFoundError):
        await service.get_project_by_contract(
            _user(permissions=["section:projects"]), "ct1"
        )


@pytest.mark.asyncio
async def test_projects_by_customer_filters_invisible_rows():
    service = ProjectsService(object())  # type: ignore[arg-type]
    visible = SimpleNamespace(id="p-visible")
    hidden = SimpleNamespace(id="p-hidden")
    service.repo = MagicMock()
    service.repo.list_by_customer_id = AsyncMock(return_value=[visible, hidden])
    service.repo.list_string_items = AsyncMock(return_value={})
    service._resolve_rows_geo = AsyncMock(return_value={})

    async def assert_visible(_user_value, row):
        if row.id == "p-hidden":
            raise PermissionDeniedError("跨范围")

    service._assert_row_visible = AsyncMock(side_effect=assert_visible)
    service._to_record = MagicMock(side_effect=lambda row, **_kwargs: _record(row.id))

    result = await service.list_projects_by_customer(
        _user(permissions=["section:projects"]), "c1"
    )

    assert [item.id for item in result.items] == ["p-visible"]
    assert result.total == 1


@pytest.mark.asyncio
async def test_related_lookup_keeps_overseas_geo_isolation():
    service = ProjectsService(object())  # type: ignore[arg-type]
    row = SimpleNamespace(id="p-cn")
    service.repo = MagicMock()
    service.repo.get_by_contract_id = AsyncMock(return_value=row)
    service.repo.get = AsyncMock(return_value=row)
    service._resolve_row_geo = AsyncMock(return_value="domestic")

    with pytest.raises(PermissionDeniedError):
        await service.get_project_by_contract(
            _user(
                permissions=["section:projects"],
                role="overseas",
                data_scope="all",
            ),
            "ct-cn",
        )


def test_backfill_module_entrypoint_starts_from_geo_api_root():
    result = subprocess.run(
        [sys.executable, "-m", "scripts.backfill_signed_contract_projects", "--help"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "--apply" in result.stdout
