"""Add configurable secondary lead source options.

Revision ID: 028_lead_source_options
Revises: 027_marketing_rbac
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "028_lead_source_options"
down_revision: Union[str, None] = "027_marketing_rbac"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lead_source_options",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("primary_source", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("primary_source", "name", name="uq_lead_source_option_name"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_lead_source_options_primary", "lead_source_options", ["primary_source"])


def downgrade() -> None:
    op.drop_index("idx_lead_source_options_primary", table_name="lead_source_options")
    op.drop_table("lead_source_options")
