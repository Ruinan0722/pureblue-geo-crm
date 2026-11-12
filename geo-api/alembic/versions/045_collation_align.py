"""035 子表 collation 对齐：utf8mb4_unicode_ci → utf8mb4_0900_ai_ci。

035 建的子表与主表 collation 不一致（如 request_regions.request_id = requests.id），
导致 region/notes 筛选等跨表比较在 MySQL 8 运行时抛 1267 Illegal mix of collations。
这里把 035 时期创建的 unicode_ci 子表统一转为 0900_ai_ci（数据与索引无损重建）。

Revision ID: 045_collation_align
Revises: 044_request_form_columns
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "045_collation_align"
down_revision: Union[str, None] = "044_request_form_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UNICODE_CI_TABLES = [
    "crm_attachments",
    "opportunity_stage_history",
    "crm_audit_change_items",
    "crm_audit_related_entities",
    "opportunity_project_types",
    "opportunity_request_ids",
    "checkin_attachments",
    "request_regions",
    "request_goals",
    "request_notes",
    "contract_owners",
]


def upgrade() -> None:
    for table in _UNICODE_CI_TABLES:
        op.execute(
            f"ALTER TABLE {table} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
        )


def downgrade() -> None:
    for table in _UNICODE_CI_TABLES:
        op.execute(
            f"ALTER TABLE {table} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )
