"""Harden unified lead integration and add Mark review outbox.

Revision ID: 025_lead_integration_hardening
Revises: 024_mark_integration
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "025_lead_integration_hardening"
down_revision: Union[str, None] = "024_mark_integration"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "mark_integration_records",
        "crm_request_id",
        new_column_name="crm_lead_id",
        existing_type=sa.String(36),
        existing_nullable=False,
    )
    op.alter_column(
        "mark_integration_files",
        "crm_request_id",
        new_column_name="crm_lead_id",
        existing_type=sa.String(36),
        existing_nullable=False,
    )
    op.create_table(
        "mark_review_callbacks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(64), nullable=False, unique=True),
        sa.Column("external_record_id", sa.String(128), nullable=False),
        sa.Column("crm_lead_id", sa.String(36), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Index("idx_mark_review_event", "event_id"),
        sa.Index("idx_mark_review_external", "external_record_id"),
        sa.Index("idx_mark_review_lead", "crm_lead_id"),
        sa.Index("idx_mark_review_status", "status"),
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("mark_review_callbacks")
    op.alter_column(
        "mark_integration_files", "crm_lead_id", new_column_name="crm_request_id",
        existing_type=sa.String(36), existing_nullable=False,
    )
    op.alter_column(
        "mark_integration_records", "crm_lead_id", new_column_name="crm_request_id",
        existing_type=sa.String(36), existing_nullable=False,
    )
