"""Persist all unified lead fields and provenance metadata.

Revision ID: 057_external_lead_fields
Revises: 056_request_target_customer
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "057_external_lead_fields"
down_revision: Union[str, None] = "056_request_target_customer"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("crm_leads", sa.Column("requirements", sa.Text(), nullable=True))
    op.alter_column(
        "crm_lead_import_meta",
        "utm_source",
        existing_type=sa.String(length=128),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
    op.add_column("crm_lead_import_meta", sa.Column("utm_medium", sa.String(255), nullable=True))
    op.add_column("crm_lead_import_meta", sa.Column("utm_campaign", sa.String(255), nullable=True))
    op.add_column("crm_lead_import_meta", sa.Column("operator_id", sa.String(128), nullable=True))
    op.add_column("crm_lead_import_meta", sa.Column("last_event_id", sa.String(64), nullable=True))
    op.add_column("crm_lead_import_meta", sa.Column("occurred_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("crm_lead_import_meta", "occurred_at")
    op.drop_column("crm_lead_import_meta", "last_event_id")
    op.drop_column("crm_lead_import_meta", "operator_id")
    op.drop_column("crm_lead_import_meta", "utm_campaign")
    op.drop_column("crm_lead_import_meta", "utm_medium")
    op.alter_column(
        "crm_lead_import_meta",
        "utm_source",
        existing_type=sa.String(length=255),
        type_=sa.String(length=128),
        existing_nullable=True,
    )
    op.drop_column("crm_leads", "requirements")
