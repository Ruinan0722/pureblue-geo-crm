"""CRM/需求/审计/打卡业务表禁止 JSON 列（业务字段已全部落列/子表）。"""

from __future__ import annotations

import pytest
from sqlalchemy import bindparam, text

from app.config import get_settings

PROTECTED_TABLES = [
    "crm_leads",
    "crm_opportunities",
    "crm_contracts",
    "crm_customers",
    "crm_sales_coverages",
    "crm_audit_records",
    "checkin_records",
    "requests",
    "crm_follow_ups",
    "lead_notes",
    "opportunity_notes",
    "projects",
]


@pytest.mark.asyncio
async def test_protected_tables_have_no_json_columns():
    from sqlalchemy.ext.asyncio import create_async_engine

    url = get_settings().database_url
    try:
        engine = create_async_engine(url)
        async with engine.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT table_name, column_name FROM information_schema.columns "
                        "WHERE table_schema=DATABASE() AND data_type='json' "
                        "AND table_name IN :tables"
                    ).bindparams(bindparam("tables", tuple(PROTECTED_TABLES), expanding=True))
                )
            ).all()
        await engine.dispose()
    except Exception as exc:  # noqa: BLE001  DB 不可用时跳过（本地无库不阻塞）
        pytest.skip(f"数据库不可用，跳过 JSON 列检查：{exc}")
    assert not rows, f"业务表仍存在 JSON 列：{[(r[0], r[1]) for r in rows]}"
