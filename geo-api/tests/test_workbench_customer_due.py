"""工作台客户待跟进：按 nextFollowAt 与中国时区今日对齐。

023 迁移后经营字段只存在于 crm_sales_coverages（主档已清空）——
SQL 聚合必须读 coverage 表，否则工作台「今日待跟进/超14天」恒为 0。
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.crm.repository import CrmRepository
from app.modules.crm.service import _aggregate_customer_workbench


def test_customers_active_uses_next_follow_vs_today():
    today = "2026-07-20"
    customers = [
        {"status": "following", "nextFollowAt": "2026-07-20", "lastFollowAt": "2026-07-01"},
        {"status": "potential", "nextFollowAt": "2026-07-19", "lastFollowAt": "2026-07-01"},  # 逾期也算
        {"status": "following", "nextFollowAt": "2026-07-21", "lastFollowAt": "2026-07-01"},  # 未来不算
        {"status": "lost", "nextFollowAt": "2026-07-20", "lastFollowAt": "2026-07-01"},  # 流失不算
        {"status": "following", "nextFollowAt": "", "lastFollowAt": "2026-07-01"},  # 未安排不算
        {"status": "cooperating", "nextFollowAt": "2026-07-20 09:00:00", "lastFollowAt": "2026-07-19"},
    ]
    out = _aggregate_customer_workbench(customers, today=today)
    assert out["customers_active"] == 3  # today + overdue + cooperating-with-datetime
    assert out["customers_cooperating"] == 1
    assert out["customers_total"] == 6


def test_customers_active_not_status_following_count():
    """回归：不再把「跟进中/潜在」全部算作今日待跟进。"""
    today = "2026-07-20"
    customers = [
        {"status": "following", "nextFollowAt": "2026-08-01", "lastFollowAt": "2026-07-19"},
        {"status": "potential", "nextFollowAt": "2026-08-02", "lastFollowAt": "2026-07-19"},
    ]
    out = _aggregate_customer_workbench(customers, today=today)
    assert out["customers_active"] == 0


@pytest.mark.asyncio
async def test_workbench_sql_reads_coverages_not_master(monkeypatch):
    """SQL 聚合改读 crm_sales_coverages（023 后主档无 nextFollowAt/lastFollowAt/status）。"""
    db = AsyncMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(total=4, active=2, stale=1, cooperating=1)
    db.execute = AsyncMock(return_value=SimpleNamespace(one=lambda: row))

    out = await repo.aggregate_customer_workbench(["u1", "u2"], today="2026-08-04")

    assert out == {
        "customers_total": 4,
        "customers_active": 2,
        "customers_stale": 1,
        "customers_cooperating": 1,
    }
    stmt = db.execute.await_args.args[0]
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "crm_sales_coverages" in sql
    assert "crm_customers" not in sql
    assert "u1" in sql and "u2" in sql  # owner 过滤生效


@pytest.mark.asyncio
async def test_workbench_stats_total_matches_status_buckets(monkeypatch):
    """统计卡 total 与状态桶同口径：都按可见 coverage 去重客户（修复卡片合计 < total）。"""
    db = AsyncMock()
    repo = CrmRepository(db)
    # total 走 coverage 子查询；状态桶走各自子查询——断言 SQL 不读主档
    rows = [SimpleNamespace(total=3, cooperating=1, awaiting_contact=1, connected=0,
                            opportunity_following=1, stopped=0, following=0, potential=0,
                            lost=0, key=1)]
    executed: list = []

    async def fake_execute(stmt):
        executed.append(stmt)
        return SimpleNamespace(scalar_one=lambda: rows[0].total if len(executed) == 1 else 0,
                               one=lambda: None)

    db.execute = fake_execute
    out = await repo.aggregate_customer_stats(["u1"], include_unassigned=False)
    first = str(executed[0].compile(compile_kwargs={"literal_binds": True}))
    assert "crm_sales_coverages" in first
    assert "crm_customers" not in first
    assert out["total"] == 3
