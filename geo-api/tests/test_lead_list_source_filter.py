"""线索列表：一级来源 + 二级来源（sourceDetail）筛选链路。"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import mysql

from app.modules.auth.schemas import AuthUser
from app.modules.crm.repository import CrmRepository
from app.modules.crm.service import CrmService


def _compile(clause) -> str:
    return str(clause.compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}))


def test_source_detail_filter_clause_single_value():
    repo = CrmRepository(AsyncMock())
    clauses = repo._lead_filter_clauses(source_detail="小红书")
    assert len(clauses) == 1
    sql = _compile(clauses[0])
    assert "source_detail" in sql
    assert "小红书" in sql


def test_source_detail_filter_clause_multi_value():
    repo = CrmRepository(AsyncMock())
    clauses = repo._lead_filter_clauses(source_detail="小红书,公众号")
    assert len(clauses) == 1
    sql = _compile(clauses[0])
    assert "source_detail" in sql
    assert "小红书" in sql
    assert "公众号" in sql


def test_source_detail_filter_ignores_all_and_empty():
    repo = CrmRepository(AsyncMock())
    assert repo._lead_filter_clauses(source_detail=None) == []
    assert repo._lead_filter_clauses(source_detail="") == []
    assert repo._lead_filter_clauses(source_detail="all") == []


def _user(*, user_id: str = "u-1", role: str = "sales") -> AuthUser:
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name=user_id,
        role=role,
        permissions=["section:leads"],
        data_scope="own",
        department_names=["销售部"],
    )


@pytest.mark.asyncio
async def test_list_leads_forwards_source_detail(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    captured: dict = {}

    async def fake_search(owner_ids, **kwargs):
        captured.update(kwargs)
        return [], 0

    monkeypatch.setattr(svc.repo, "search_leads", fake_search)
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=["u-1"]))
    monkeypatch.setattr(svc, "_include_unassigned", lambda user, **kwargs: False)
    monkeypatch.setattr(svc, "_sdr_pool_names", AsyncMock(return_value=[]))

    await svc.list_leads(
        _user(),
        source="内容营销",
        source_detail="小红书,公众号",
    )

    assert captured["source"] == "内容营销"
    assert captured["source_detail"] == "小红书,公众号"
