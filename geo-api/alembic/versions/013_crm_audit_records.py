"""crm audit records (操作历史入库)

Revision ID: 013_crm_audit_records
Revises: 012_crm_entities
Create Date: 2026-07-20
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "013_crm_audit_records"
down_revision: Union[str, None] = "012_crm_entities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crm_audit_records",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("module", sa.String(32), nullable=False),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("related_entity_ids", sa.JSON(), nullable=True),
        sa.Column("entity_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("actor_user_id", sa.String(36), nullable=True),
        sa.Column("timestamp_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_crm_audit_module", "crm_audit_records", ["module"])
    op.create_index("idx_crm_audit_entity", "crm_audit_records", ["entity_id"])
    op.create_index("idx_crm_audit_actor", "crm_audit_records", ["actor_user_id"])
    op.create_index("idx_crm_audit_ts", "crm_audit_records", ["timestamp_at"])


def downgrade() -> None:
    op.drop_index("idx_crm_audit_ts", table_name="crm_audit_records")
    op.drop_index("idx_crm_audit_actor", table_name="crm_audit_records")
    op.drop_index("idx_crm_audit_entity", table_name="crm_audit_records")
    op.drop_index("idx_crm_audit_module", table_name="crm_audit_records")
    op.drop_table("crm_audit_records")
