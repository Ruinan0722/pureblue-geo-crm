"""项目字符串子表：写穿同步 + 批量读取 + 序列化。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.projects.repository import ProjectsRepository
from app.modules.projects.service import ProjectsService


@pytest.mark.asyncio
async def test_sync_and_list_string_items():
    db = AsyncMock()
    db.add = MagicMock()
    repo = ProjectsRepository(db)
    await repo.sync_string_items(
        "p1",
        project_types=["监测", "排名优化"],
        platforms=["豆包"],
    )
    added = [c.args[0] for c in db.add.call_args_list]
    items = [x for x in added if x.__class__.__name__ == "ProjectStringItem"]
    assert len(items) == 3
    assert [x.kind for x in items] == ["project_types", "project_types", "platforms"]
    assert items[0].value == "监测"
    assert items[0].sort_order == 0


@pytest.mark.asyncio
async def test_list_string_items_assembles():
    db = AsyncMock()
    db.add = MagicMock()
    repo = ProjectsRepository(db)
    row = SimpleNamespace(
        project_id="p1",
        kind="project_types",
        value="监测",
        sort_order=0,
    )
    db.execute.return_value = SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: [row])
    )
    out = await repo.list_string_items(["p1"])
    assert out["p1"] == {"project_types": ["监测"], "platforms": []}


def test_to_record_uses_string_items():
    svc = ProjectsService(object())  # type: ignore[arg-type]
    row = SimpleNamespace(
        id="p1",
        name="项目",
        customer_id="c1",
        customer_name="Acme",
        source_contract_id="ct1",
        opportunity_id=None,
        geo_source="domestic",
        stage="active",
        health="healthy",
        risk_level="low",
        biz_owner="",
        biz_owner_user_id=None,
        project_manager="",
        project_manager_user_id=None,
        executor="",
        executor_user_id=None,
        content_ops="",
        content_ops_user_id=None,
        contract_amount=None,
        customer_industry="",
        customer_type="",
        customer_region="",
        intent_brand=0,
        intent_content=0,
        intent_search=0,
        kpi_notes="",
        start_date=None,
        sow_end_date=None,
        delay_reason="",
        created_at=None,
        updated_at=None,
        created_by=None,
        updated_by=None,
        archived_at=None,
    )
    rec = svc._to_record(
        row,
        geo_source="domestic",
        string_items={"project_types": ["监测"], "platforms": ["豆包"]},
    )
    assert rec.project_types == ["监测"]
    assert rec.platforms == ["豆包"]
