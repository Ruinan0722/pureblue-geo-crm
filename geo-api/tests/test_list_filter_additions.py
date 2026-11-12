"""列表补充筛选：需求单、项目、客户 —— 子句生成与参数透传。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import mysql

from app.modules.crm.repository import CrmRepository
from app.modules.projects.repository import ProjectsRepository
from app.modules.requests.repository import RequestRepository


def _compile(clause) -> str:
    return str(clause.compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}))


# —— 需求单 ——


def test_request_region_goal_submitted_clauses():
    repo = RequestRepository(AsyncMock())
    clauses = repo._list_filter_clauses(
        region="US",
        goal="recommend",
        submitted_from="2026-08-01",
        submitted_to="2026-08-31",
    )
    sql = " ".join(_compile(c) for c in clauses)
    assert "request_regions" in sql
    assert "US" in sql
    assert "request_goals" in sql
    assert "recommend" in sql
    assert "date(requests.submitted_at)" in sql.lower()
    assert "2026-08-01" in sql
    assert "2026-08-31" in sql


# —— 项目 ——


@pytest.mark.asyncio
async def test_project_list_filter_params_apply():
    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    repo = ProjectsRepository(db)

    captured = {}

    async def fake_execute(stmt, *args, **kwargs):
        captured["sql"] = str(stmt.compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}))
        return result

    db.execute.side_effect = fake_execute
    await repo.list_projects(
        view="active",
        amount_min=100,
        amount_max=5000,
        sow_from="2026-09-01",
        sow_to="2026-12-31",
        updated_from="2026-08-01",
        updated_to="2026-08-31",
        due_days_min=0,
        due_days_max=30,
    )
    sql = captured.get("sql", "")
    assert "contract_amount >= 100" in sql
    assert "contract_amount <= 5000" in sql
    assert "sow_end_date >= '2026-09-01'" in sql
    assert "sow_end_date <= '2026-12-31'" in sql
    assert "updated_at >= '2026-08-01'" in sql
    assert "updated_at < '2026-08-31 23:59:59'" in sql
    assert "datediff" in sql.lower()


# —— 客户 ——


def test_customer_follow_and_relation_clauses():
    repo = CrmRepository(AsyncMock())
    clauses = repo._customer_filter_clauses(
        last_follow_from="2026-08-01",
        last_follow_to="2026-08-31",
        next_follow_from="2026-09-01",
        relation="none",
        owner_ids=["u-1", "u-2"],
    )
    sql = " ".join(_compile(c) for c in clauses)
    assert "last_follow_at" in sql
    assert "next_follow_at" in sql
    assert "crm_opportunities" in sql
    assert "crm_contracts" in sql
    assert "2026-08-01" in sql
    assert "u-1" in sql


def test_customer_relation_opp_clause():
    repo = CrmRepository(AsyncMock())
    clauses = repo._customer_filter_clauses(relation="opp", owner_ids=None)
    assert len(clauses) == 1
    assert "crm_opportunities" in _compile(clauses[0])
