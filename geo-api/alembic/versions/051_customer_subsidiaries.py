"""客户子公司独立表：crm_customer_subsidiaries（公司架构）。

Revision ID: 051_customer_subsidiaries
Revises: 050_project_string_items_audit
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "051_customer_subsidiaries"
down_revision: Union[str, None] = "050_project_string_items_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crm_customer_subsidiaries",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("customer_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("short_name", sa.String(128), nullable=True),
        sa.Column("credit_code", sa.String(64), nullable=True),
        sa.Column("city", sa.String(128), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_crm_customer_subsidiaries_customer_id",
        "crm_customer_subsidiaries",
        ["customer_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_crm_customer_subsidiaries_customer_id", table_name="crm_customer_subsidiaries")
    op.drop_table("crm_customer_subsidiaries")
