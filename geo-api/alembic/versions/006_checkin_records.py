"""checkin records table

Revision ID: 006_checkin_records
Revises: 005_dir_profiles
Create Date: 2026-07-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_checkin_records"
down_revision: Union[str, None] = "005_dir_profiles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "checkin_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("user_name", sa.String(128), nullable=False),
        sa.Column("department_names", sa.Text(), nullable=False),
        sa.Column("visit_id", sa.String(36), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("beijing_time", sa.String(32), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("accuracy", sa.Float(), nullable=True),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("province", sa.String(64), nullable=True),
        sa.Column("city", sa.String(64), nullable=True),
        sa.Column("district", sa.String(64), nullable=True),
        sa.Column("attachment_ids", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_checkin_user", "checkin_records", ["user_id"])
    op.create_index("idx_checkin_timestamp", "checkin_records", ["timestamp"])
    op.create_index("idx_checkin_visit", "checkin_records", ["visit_id"])


def downgrade() -> None:
    op.drop_index("idx_checkin_visit", table_name="checkin_records")
    op.drop_index("idx_checkin_timestamp", table_name="checkin_records")
    op.drop_index("idx_checkin_user", table_name="checkin_records")
    op.drop_table("checkin_records")
