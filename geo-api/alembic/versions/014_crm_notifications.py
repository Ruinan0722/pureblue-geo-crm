"""crm notifications + users directory support

Revision ID: 014_crm_notifications
Revises: 013_crm_audit_records
Create Date: 2026-07-20
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014_crm_notifications"
down_revision: Union[str, None] = "013_crm_audit_records"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crm_notifications",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("target_name", sa.String(128), nullable=False),
        sa.Column("target_user_id", sa.String(36), nullable=True),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("actor_user_id", sa.String(36), nullable=True),
        sa.Column("message", sa.String(512), nullable=False),
        sa.Column("href", sa.String(512), nullable=False, server_default=""),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_crm_ntf_target_user", "crm_notifications", ["target_user_id"])
    op.create_index("idx_crm_ntf_target_name", "crm_notifications", ["target_name"])
    op.create_index("idx_crm_ntf_created", "crm_notifications", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_crm_ntf_created", table_name="crm_notifications")
    op.drop_index("idx_crm_ntf_target_name", table_name="crm_notifications")
    op.drop_index("idx_crm_ntf_target_user", table_name="crm_notifications")
    op.drop_table("crm_notifications")
