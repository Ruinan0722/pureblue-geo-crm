"""线索二级来源支持机构引荐（start_date/organizer 可空 + 种子 ToBCGO）。"""

from __future__ import annotations

from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "054_institution_source"
down_revision: Union[str, None] = "053_provenance_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "lead_source_options",
        "start_date",
        existing_type=sa.Date(),
        nullable=True,
    )
    op.alter_column(
        "lead_source_options",
        "organizer",
        existing_type=sa.String(128),
        nullable=True,
    )

    now = datetime.utcnow()
    lead_source_options = sa.table(
        "lead_source_options",
        sa.column("id", sa.String(36)),
        sa.column("primary_source", sa.String(64)),
        sa.column("start_date", sa.Date()),
        sa.column("name", sa.String(128)),
        sa.column("organizer", sa.String(128)),
        sa.column("enabled", sa.Boolean()),
        sa.column("sort_order", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.bulk_insert(
        lead_source_options,
        [
            {
                "id": "lso-institution-tobcgo",
                "primary_source": "机构引荐",
                "start_date": None,
                "name": "ToBCGO",
                "organizer": None,
                "enabled": True,
                "sort_order": 0,
                "created_at": now,
                "updated_at": now,
            }
        ],
    )


def downgrade() -> None:
    # 旧 schema 要求 start_date/organizer 非空：先清理机构引荐等可空行（含 ToBCGO 种子），
    # 再恢复 NOT NULL，保证降级确定性且不留下 NULL 行导致 ALTER 失败。
    op.execute(
        "DELETE FROM lead_source_options WHERE start_date IS NULL OR organizer IS NULL"
    )
    op.alter_column(
        "lead_source_options",
        "organizer",
        existing_type=sa.String(128),
        nullable=False,
    )
    op.alter_column(
        "lead_source_options",
        "start_date",
        existing_type=sa.Date(),
        nullable=False,
    )
