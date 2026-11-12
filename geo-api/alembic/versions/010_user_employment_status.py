"""add users employment_status and left_at for resigned staff

Revision ID: 010_user_employment_status
Revises: 009_checkin_view_team
Create Date: 2026-07-14
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010_user_employment_status"
down_revision: Union[str, None] = "009_checkin_view_team"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "employment_status",
            sa.String(length=16),
            nullable=False,
            server_default="active",
        ),
    )
    op.add_column(
        "users",
        sa.Column("left_at", sa.DateTime(timezone=False), nullable=True),
    )
    op.create_index("idx_users_employment_status", "users", ["employment_status"])


def downgrade() -> None:
    op.drop_index("idx_users_employment_status", table_name="users")
    op.drop_column("users", "left_at")
    op.drop_column("users", "employment_status")
