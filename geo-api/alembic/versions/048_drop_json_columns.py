"""第 6 项：删除各实体 JSON 列（读路径已全部切列/子表）。

删除前幂等回填 requests.geo_source（export 过滤已切列；旧行可能为空）。

Revision ID: 048_drop_json_columns
Revises: 047_item6_prereqs
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "048_drop_json_columns"
down_revision: Union[str, None] = "047_item6_prereqs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE requests SET geo_source = CASE "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.importMeta.source')) = '国内GEO需求' "
            "OR code LIKE 'GEO-CN%' THEN 'domestic' "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.importMeta.source')) = '海外GEO需求' "
            "OR code LIKE 'GEO-OV%' THEN 'overseas' "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.importMeta.source')) = '麦思博GEO需求' "
            "OR code LIKE 'GEO-MS%' THEN 'mestbo' "
            "ELSE 'manual' END "
            "WHERE geo_source IS NULL OR geo_source = ''"
        )
    )
    for table, column in [
        ("crm_leads", "document"),
        ("crm_opportunities", "document"),
        ("crm_contracts", "document"),
        ("crm_customers", "document"),
        ("crm_sales_coverages", "document"),
        ("requests", "data"),
        ("requests", "notes"),
        ("requests", "attachments"),
        ("crm_audit_records", "changes"),
        ("crm_audit_records", "related_entity_ids"),
        ("checkin_records", "attachments"),
    ]:
        op.drop_column(table, column)


def downgrade() -> None:
    raise RuntimeError("删 JSON 列不可回退：数据已迁移到列/子表，需从备份恢复")
