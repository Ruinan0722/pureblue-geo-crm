"""feishu sales contacts snapshot tables

Revision ID: 002_feishu_contacts
Revises: 001_initial
Create Date: 2026-07-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_feishu_contacts"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feishu_sales_contacts",
        sa.Column("feishu_open_id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("department_ids", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("synced_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.Index("idx_fsc_active_name", "is_active", "name"),
        mysql_charset="utf8mb4",
    )

    op.create_table(
        "feishu_sync_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job_name", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("record_count", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=False), nullable=True),
        sa.Index("idx_fsl_job_started", "job_name", "started_at"),
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("feishu_sync_logs")
    op.drop_table("feishu_sales_contacts")
