"""RBAC 时间戳列补齐（ORM 要求 created_at / updated_at）。

Revision ID: 032_rbac_timestamps
Revises: 031_crm_business_columns
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "032_rbac_timestamps"
down_revision: Union[str, None] = "031_crm_business_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_timestamps(table: str) -> None:
    for column in ("created_at", "updated_at"):
        op.add_column(
            table,
            sa.Column(
                column,
                sa.DateTime(timezone=False),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
        )
    for column in ("created_at", "updated_at"):
        op.alter_column(table, column, server_default=None)


def upgrade() -> None:
    _add_timestamps("rbac_permissions")
    _add_timestamps("user_role_assignments")
    _add_timestamps("user_permission_overrides")


def downgrade() -> None:
    for table in ("user_permission_overrides", "user_role_assignments", "rbac_permissions"):
        op.drop_column(table, "updated_at")
        op.drop_column(table, "created_at")
